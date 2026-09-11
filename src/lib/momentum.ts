import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { investorLabel } from "@/lib/tracker";

/**
 * Deal momentum: where is a deal stuck waiting on somebody?
 *   SPONSOR_ITEMS  we asked the sponsor for something and have not heard back
 *   INTRO          an intro was made and one side is slow to set up the call
 *   ACTION         an action item from a call is still open
 * The email log gives us the threads; Claude reads the last few messages of each and says who owes whom.
 * Results are cached in Momentum rows and only re-read when the thread has a newer message.
 */

const DAY = 86_400_000;
const QUIET_DAYS = 2;
const INTERNAL = /@(rjlcapadvisors|rjlequities)\.com$/i;

const Read = z.object({
  waitingOn: z.enum(["sponsor", "lp", "us", "nobody"]).describe("Who owes the next move. 'us' means RJL owes a reply; 'nobody' when the thread is resolved or purely informational."),
  summary: z.string().describe("One short line, analyst tone, naming what is outstanding, e.g. 'Rent roll and T12 requested Aug 26; no reply' or 'Call times proposed to LP Sep 2; awaiting their pick'. Empty if nobody."),
});

type Thread = { subject: string | null; direction: string | null; occurredAt: Date; body: string | null; from: string; externalId: string | null; contactId: string | null };

async function readThread(kind: "sponsor" | "intro", dealName: string, party: string, msgs: Thread[]) {
  const client = new Anthropic();
  const text = msgs
    .slice(-6)
    .map((m) => `[${m.occurredAt.toISOString().slice(0, 10)}] ${m.direction === "OUTBOUND" ? "RJL" : party} (${m.from}): ${m.subject ?? ""}\n${(m.body ?? "").slice(0, 600)}`)
    .join("\n\n");
  const res = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 400,
    system:
      kind === "sponsor"
        ? "You read the recent emails between RJL Capital Advisors (a real estate capital advisor) and a deal sponsor. Decide whether RJL is waiting on the sponsor for something (documents, answers, a model, a decision), whether RJL owes the sponsor a reply, or whether nothing is outstanding. Previews may be truncated; judge from what is there."
        : "You read recent emails after RJL Capital Advisors introduced an investor (LP) to a deal sponsor. Decide who is slow: the LP (owes times/response), the sponsor (owes times/response), RJL, or nobody (call set or thread resolved). Previews may be truncated.",
    messages: [{ role: "user", content: `Deal: ${dealName}\nCounterparty: ${party}\n\n${text}` }],
    output_config: { format: zodOutputFormat(Read) },
  });
  return res.parsed_output;
}

async function upsert(dealId: string, kind: string, party: string, data: { companyId?: string | null; contactId?: string | null; summary: string; waitingSince: Date; lastMessageId?: string | null }) {
  const existing = await prisma.momentum.findUnique({ where: { dealId_kind_party: { dealId, kind, party } } });
  if (existing?.status === "DISMISSED" && existing.lastMessageId === (data.lastMessageId ?? null)) return; // he dismissed this exact state
  if (existing?.status === "DONE" && existing.lastMessageId && existing.lastMessageId === (data.lastMessageId ?? null)) return; // handled and sent; nothing new since
  await prisma.momentum.upsert({ where: { dealId_kind_party: { dealId, kind, party } }, create: { dealId, kind, party, status: "OPEN", ...data }, update: { ...data, status: "OPEN" } });
}

async function close(dealId: string, kind: string, party: string) {
  await prisma.momentum.updateMany({ where: { dealId, kind, party, status: "OPEN" }, data: { status: "DONE" } });
}

export async function refreshMomentum(): Promise<{ checked: number; open: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { checked: 0, open: 0 };
  // deals sponsors mentioned in email but never sent become "Deal Mentioned" tickets first
  await import("@/lib/mentions").then((m) => m.detectMentionedDeals()).catch(() => ({ threads: 0, created: [] }));
  // sponsor answers and engagement confirmations that arrived in team mailboxes
  await import("@/lib/engagement").then((m) => m.syncEngagementDrafts()).catch(() => 0);
  await import("@/lib/sponsor-replies").then((m) => m.processSponsorReplies()).catch(() => null);
  const now = Date.now();
  const deals = await prisma.deal.findMany({
    where: { stage: { in: [...ACTIVE_STAGES] }, OR: [{ hubspotId: null }, { stage: { notIn: ["Deal Received", "Deal Mentioned"] } }, { investors: { some: {} } }] },
    include: { sponsorCompany: { select: { id: true, name: true } }, investors: { where: { status: 6 }, include: { contact: { include: { company: { select: { id: true, name: true } } } } } } },
  });
  let checked = 0;

  for (const d of deals) {
    const name = d.propertyName ?? d.name;

    // 1) sponsor: the latest thread with the sponsor company
    if (d.sponsorCompany) {
      const msgs = await prisma.activity.findMany({ where: { companyId: d.sponsorCompany.id, type: "EMAIL", occurredAt: { gte: new Date(now - 90 * DAY) } }, orderBy: { occurredAt: "asc" }, take: 40, select: { subject: true, direction: true, occurredAt: true, body: true, meta: true, externalId: true, contactId: true } });
      if (msgs.length) {
        const last = msgs[msgs.length - 1];
        const party = d.sponsorCompany.name;
        const existing = await prisma.momentum.findUnique({ where: { dealId_kind_party: { dealId: d.id, kind: "SPONSOR_ITEMS", party } } });
        const stale = now - last.occurredAt.getTime() >= QUIET_DAYS * DAY;
        if (!stale) await close(d.id, "SPONSOR_ITEMS", party);
        else if (!existing || existing.lastMessageId !== last.externalId) {
          checked++;
          const thread: Thread[] = msgs.slice(-6).map((m) => ({ ...m, from: (JSON.parse(m.meta ?? "{}").from?.address as string) ?? "" }));
          const r = await readThread("sponsor", name, party, thread).catch(() => null);
          if (r?.waitingOn === "sponsor") await upsert(d.id, "SPONSOR_ITEMS", party, { companyId: d.sponsorCompany.id, contactId: last.contactId, summary: r.summary, waitingSince: last.occurredAt, lastMessageId: last.externalId });
          else await close(d.id, "SPONSOR_ITEMS", party);
        }
      }
    }

    // 2) intros: LP rows at "Intro Made"
    for (const r of d.investors) {
      const lpCo = r.contact.company;
      const party = investorLabel(r.contact);
      const msgs = await prisma.activity.findMany({ where: { type: "EMAIL", occurredAt: { gte: new Date(r.updatedAt.getTime() - 3 * DAY) }, OR: [{ dealId: d.id }, ...(lpCo ? [{ companyId: lpCo.id }] : []), { contactId: r.contactId }] }, orderBy: { occurredAt: "asc" }, take: 40, select: { subject: true, direction: true, occurredAt: true, body: true, meta: true, externalId: true, contactId: true } });
      const last = msgs[msgs.length - 1];
      const since = last?.occurredAt ?? r.updatedAt;
      if (now - since.getTime() < QUIET_DAYS * DAY) {
        await close(d.id, "INTRO", party);
        continue;
      }
      const existing = await prisma.momentum.findUnique({ where: { dealId_kind_party: { dealId: d.id, kind: "INTRO", party } } });
      if (existing && existing.lastMessageId === (last?.externalId ?? null) && existing.status !== "DONE") continue;
      checked++;
      if (!msgs.length) {
        await upsert(d.id, "INTRO", party, { companyId: lpCo?.id, contactId: r.contactId, summary: `Intro made ${r.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}; no emails since`, waitingSince: r.updatedAt, lastMessageId: null });
        continue;
      }
      const thread: Thread[] = msgs.slice(-6).map((m) => ({ ...m, from: (JSON.parse(m.meta ?? "{}").from?.address as string) ?? "" }));
      const read = await readThread("intro", name, `${party} / ${d.sponsorName ?? "sponsor"}`, thread).catch(() => null);
      if (read && read.waitingOn !== "nobody" && read.waitingOn !== "us") await upsert(d.id, "INTRO", party, { companyId: lpCo?.id, contactId: r.contactId, summary: `${read.waitingOn === "lp" ? "LP" : "Sponsor"} slow: ${read.summary}`, waitingSince: last.occurredAt, lastMessageId: last.externalId });
      else await close(d.id, "INTRO", party);
    }
  }

  // 3) a sponsor mentioned a deal and never sent it (mentions the sponsor promised to send, or that Jonathan logged himself)
  const mentionedAll = await prisma.deal.findMany({ where: { stage: "Deal Mentioned", updatedAt: { lte: new Date(now - QUIET_DAYS * DAY) } }, include: { sponsorCompany: { select: { id: true, name: true } } } });
  const mentioned = mentionedAll.filter((d) => {
    try {
      const det = JSON.parse(d.details || "{}") as { promised?: boolean; mentionedIn?: string };
      return det.mentionedIn ? det.promised !== false : true;
    } catch {
      return true;
    }
  });
  for (const d of mentioned) {
    const party = d.sponsorName ?? d.sponsorCompany?.name ?? "Sponsor";
    const last = d.sponsorCompany ? await prisma.activity.findFirst({ where: { companyId: d.sponsorCompany.id, type: "EMAIL" }, orderBy: { occurredAt: "desc" }, select: { externalId: true, contactId: true } }) : null;
    await upsert(d.id, "MENTIONED", party, { companyId: d.sponsorCompany?.id, contactId: last?.contactId, summary: `Mentioned ${d.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}; deal never sent`, waitingSince: d.updatedAt, lastMessageId: last?.externalId ?? null });
  }
  await prisma.momentum.updateMany({ where: { kind: "MENTIONED", status: "OPEN", NOT: { dealId: { in: mentioned.map((d) => d.id) } } }, data: { status: "DONE" } });

  // 3a) engagement letter sent and the sponsor has not answered in 18 hours
  const ENGAGEMENT_HOURS = 18;
  const letters = await prisma.deal.findMany({ where: { stage: "Engagement Letter Sent" }, include: { sponsorCompany: { select: { id: true, name: true } } } });
  const liveLetterDeals = new Set<string>();
  for (const d of letters) {
    let det: { engagementSentAt?: string; engagementDraftId?: string; engagementMailbox?: string } = {};
    try { det = JSON.parse(d.details || "{}"); } catch { /* ignore */ }
    if (!det.engagementSentAt) continue;
    const sentAt = new Date(det.engagementSentAt);
    if (now - sentAt.getTime() < ENGAGEMENT_HOURS * 3600_000) continue;
    const reply = d.sponsorCompanyId ? await prisma.activity.findFirst({ where: { companyId: d.sponsorCompanyId, type: "EMAIL", direction: "INBOUND", occurredAt: { gt: sentAt } }, select: { id: true } }) : null;
    if (reply) continue;
    liveLetterDeals.add(d.id);
    const party = d.sponsorName ?? d.sponsorCompany?.name ?? "Sponsor";
    let lastMessageId: string | null = null;
    if (det.engagementDraftId && det.engagementMailbox) {
      const { getMessage } = await import("@/lib/graph");
      lastMessageId = (await getMessage(det.engagementMailbox, det.engagementDraftId, "id,internetMessageId").catch(() => null))?.internetMessageId ?? null;
    }
    const sponsorContact = d.sponsorCompanyId ? await prisma.contact.findFirst({ where: { companyId: d.sponsorCompanyId, email: { not: null } }, orderBy: { lastActivityAt: "desc" }, select: { id: true } }) : null;
    await upsert(d.id, "ENGAGEMENT", party, { companyId: d.sponsorCompanyId, contactId: sponsorContact?.id ?? null, summary: `Engagement letter sent ${sentAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}; no reply from the sponsor`, waitingSince: sentAt, lastMessageId });
  }
  await prisma.momentum.updateMany({ where: { kind: "ENGAGEMENT", status: "OPEN", NOT: { dealId: { in: [...liveLetterDeals] } } }, data: { status: "DONE" } });

  // 3b) an LP asked the sponsor for something: goes to the top of the list, Handle drafts the request to the sponsor
  const { detectLpAsks } = await import("@/lib/lp-asks");
  for (const ask of await detectLpAsks().catch(() => [])) {
    const d = await prisma.deal.findUnique({ where: { id: ask.dealId }, select: { sponsorCompanyId: true, sponsorName: true } });
    await upsert(ask.dealId, "LP_ASK", ask.lpName, { companyId: d?.sponsorCompanyId ?? null, contactId: ask.contactId, summary: `${ask.lpName} asks: ${ask.asks.join("; ")}${ask.answered.length ? ` | Already on the ticket: ${ask.answered.map((x) => `${x.ask} -> ${x.answer.slice(0, 120)}`).join(" / ")}` : ""}`, waitingSince: ask.at, lastMessageId: ask.messageId });
  }

  // 4) open action items older than QUIET_DAYS (Fireflies will feed these once connected)
  const actions = await prisma.dealAction.findMany({ where: { done: false, createdAt: { lte: new Date(now - QUIET_DAYS * DAY) }, deal: { stage: { in: [...ACTIVE_STAGES] } } }, include: { deal: { select: { id: true, sponsorCompanyId: true, sponsorName: true } } } });
  for (const a of actions) await upsert(a.deal.id, "ACTION", a.text.slice(0, 120), { companyId: a.deal.sponsorCompanyId, summary: a.text, waitingSince: a.createdAt });
  await prisma.momentum.updateMany({ where: { kind: "ACTION", status: "OPEN", NOT: { party: { in: actions.map((a) => a.text.slice(0, 120)) } } }, data: { status: "DONE" } });

  const open = await prisma.momentum.count({ where: { status: "OPEN" } });
  return { checked, open };
}

export async function listMomentum(since?: Date) {
  await import("@/lib/handled").then((m) => m.syncHandledMomentum()).catch(() => 0);
  const rows = await prisma.momentum.findMany({ where: { status: "OPEN", ...(since ? { waitingSince: { gte: since } } : {}) }, orderBy: { waitingSince: "asc" } });
  // a deal that is lost or closed takes its items off the board with it
  const deals = new Map((await prisma.deal.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.dealId))] }, stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, propertyName: true } })).map((d) => [d.id, d]));
  // LP requests first (newest on top), then everything else oldest-waiting first
  const live = rows.map((r) => ({ ...r, deal: deals.get(r.dealId)! })).filter((r) => r.deal);
  // One matter, one item. The same party can surface several ways (an LP request, a sponsor item, an intro, a
  // "mentioned, never sent"): keep the most actionable one when they are about the same deal, or when one item
  // talks about the deal of the other (Sierra asking Marble to see Core & Main, and the Core & Main mention).
  const RANK: Record<string, number> = { LP_ASK: 0, SPONSOR_ITEMS: 1, ENGAGEMENT: 1, INTRO: 2, ACTION: 3, MENTIONED: 4 };
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|llc|group|capital|partners|club|inc)\b/g, " ").replace(/\s+/g, " ").trim();
  const dealWords = (d: { name: string; propertyName: string | null }) => norm(d.propertyName ?? d.name).split(" ").filter((w) => w.length > 3);
  const sameMatter = (x: (typeof live)[number], y: (typeof live)[number]) => {
    if (x.dealId === y.dealId) return true;
    const xw = dealWords(x.deal), yw = dealWords(y.deal);
    const xs = norm(`${x.summary} ${x.deal.propertyName ?? x.deal.name}`), ys = norm(`${y.summary} ${y.deal.propertyName ?? y.deal.name}`);
    if ((yw.length > 0 && yw.filter((w) => xs.includes(w)).length >= Math.ceil(yw.length * 0.6)) || (xw.length > 0 && xw.filter((w) => ys.includes(w)).length >= Math.ceil(xw.length * 0.6))) return true;
    // the two summaries tell the same story (same party, same dates, same ask): an intro item and a sponsor item written about one exchange
    const dates = (t: string) => new Set((t.toLowerCase().match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/g) ?? []).map((d) => d.replace(/[a-z]+/, (m) => m.slice(0, 3)).replace(/\.\s+/, " ").replace(/\s+/g, " ")));
    const dx = dates(x.summary), dy = dates(y.summary);
    if (dx.size && [...dx].some((d) => dy.has(d))) return true;
    const A = new Set(norm(x.summary).split(" ").filter((w) => w.length > 3)), B = new Set(norm(y.summary).split(" ").filter((w) => w.length > 3));
    let hit = 0;
    for (const w of A) if (B.has(w)) hit++;
    return A.size > 4 && B.size > 4 && hit / Math.min(A.size, B.size) >= 0.5;
  };
  const kept: typeof live = [];
  for (const r of [...live].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || a.waitingSince.getTime() - b.waitingSince.getTime())) {
    // a "mentioned, never sent" item is redundant once anything else is open on that deal, whoever the party
    if (r.kind === "MENTIONED" && live.some((o) => o.dealId === r.dealId && o.kind !== "MENTIONED")) continue;
    if (kept.some((k) => norm(k.party) === norm(r.party) && sameMatter(k, r))) continue;
    kept.push(r);
  }
  // LP requests first (newest on top), then everything else oldest-waiting first
  return kept.sort((a, b) => (a.kind === "LP_ASK") === (b.kind === "LP_ASK") ? (a.kind === "LP_ASK" ? b.waitingSince.getTime() - a.waitingSince.getTime() : a.waitingSince.getTime() - b.waitingSince.getTime()) : a.kind === "LP_ASK" ? -1 : 1);
}

export const isInternal = (addr: string) => INTERNAL.test(addr);
