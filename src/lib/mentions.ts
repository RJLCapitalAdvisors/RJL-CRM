import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
import { ASSET_CLASSES, parseList } from "@/lib/taxonomy";

/**
 * Deals sponsors mention but never send. Reads recent email threads with Sponsor companies (full bodies
 * from Graph), asks Claude which specific deals were mentioned or promised, and creates a "Deal Mentioned"
 * ticket for each one we do not already have. Deal momentum then nags when it goes quiet.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 30;
const q = (s: string) => encodeURIComponent(s);

const Out = z.object({
  deals: z.array(
    z.object({
      name: z.string().describe("Short deal or property name as the sponsor refers to it, e.g. 'Boiling Springs'."),
      location: z.string().describe("City, ST if stated, else empty."),
      assetClass: z.enum([...ASSET_CLASSES, ""]).describe("Asset class if clear, else empty."),
      whatWasSaid: z.string().describe("One line: what the sponsor said about it and whether they promised to send it."),
      promised: z.boolean().describe("True if the sponsor said they would send the deal / details / a package."),
    }),
  ),
});

const SYSTEM = `You read recent emails between RJL Capital Advisors (a real estate capital advisor) and a deal sponsor. List every SPECIFIC deal or property the sponsor mentioned that RJL might work on: things like "the Boiling Springs deal", "our Tucson site", "a 200-unit deal in Dallas we are closing". Skip deals RJL clearly already has in hand (they discuss investor feedback, tracker, or the deal was clearly already sent), generic market talk, and RJL's own deals being pitched to this person. One entry per deal, deduplicated.`;

function fuzzyMatch(a: string, b: string) {
  const w = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3));
  const A = w(a), B = w(b);
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit > 0 && hit >= Math.min(A.size, B.size) * 0.5;
}

/** "Everett" against "Everett Mall Plaza": one name is a whole-word part of the other (5+ letters), same deal. */
function nameContains(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const x = n(a), y = n(b);
  if (x.length < 5 || y.length < 5) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return new RegExp(`(^| )${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(long);
}

/** Our deal emails read "Retail Acquisitions Opportunity in Fort Lauderdale, FL | $12MM of JV Equity"; a thread carrying that is LPs answering a send, never a sponsor mentioning a new deal. */
const LAUNCH_SUBJECT = /opportunity in .+\|\s*\$[\d.,]+\s*(?:MM|M|million)\b/i;
const AUTO_REPLY = /^\s*(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|undeliverable|delivery (status|failure))/i;

export async function detectMentionedDeals(): Promise<{ threads: number; created: string[] }> {
  if (!graphConfigured() || !process.env.ANTHROPIC_API_KEY) return { threads: 0, created: [] };
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  // recent email with sponsor companies, newest first, one thread per subject
  const acts = await prisma.activity.findMany({
    where: { type: "EMAIL", occurredAt: { gte: since }, externalId: { not: null }, company: { roles: { contains: "Sponsor" } } },
    include: { company: { select: { id: true, name: true, roles: true } } },
    orderBy: { occurredAt: "desc" },
    take: 400,
  });
  const norm = (s: string | null) => (s ?? "").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();
  const threads = new Map<string, typeof acts>();
  for (const a of acts) {
    const key = `${a.companyId}|${norm(a.subject)}`;
    const list = threads.get(key) ?? [];
    if (list.length < 5) list.push(a);
    threads.set(key, list);
  }
  const created: string[] = [];
  let scanned = 0;
  const client = new Anthropic();
  for (const [, msgs] of threads) {
    const newest = msgs[0];
    if (await prisma.mentionScan.findUnique({ where: { externalId: newest.externalId! } })) continue; // this thread state already read
    const company = newest.company!;
    // Sep 16: Clarion's out-of-office reply to the Gateway launch became "Clarion Partners LLC | Fort Lauderdale Retail
    // Acquisition", and six LPs' replies then landed on it. A reply to one of our deal emails, or any auto-reply, is
    // not a sponsor mentioning a deal: mark the thread read and move on.
    const subjectsInThread = msgs.map((m) => m.subject ?? "");
    const ourSend = subjectsInThread.some((x) => LAUNCH_SUBJECT.test(x)) || msgs.some((m) => m.direction === "OUTBOUND" && LAUNCH_SUBJECT.test(m.subject ?? ""));
    const autoReply = AUTO_REPLY.test(newest.subject ?? "");
    const isLpOnAnyDeal = (await prisma.dealInvestor.count({ where: { contact: { companyId: company.id }, deal: { stage: { in: ["Deal Taken To Market", "Intro To Capital Made", "Engagement Letter Signed", "Term Sheet Received", "Deal Sent"] } } } })) > 0;
    if (ourSend || autoReply || (isLpOnAnyDeal && subjectsInThread.some((x) => /\bopportunity\b/i.test(x)))) {
      await prisma.mentionScan.create({ data: { externalId: newest.externalId!, companyId: company.id } }).catch(() => {});
      continue;
    }
    // full bodies from the mailbox that holds them
    const parts: string[] = [];
    for (const m of [...msgs].reverse()) {
      const meta = m.meta ? (JSON.parse(m.meta) as { mailbox?: string; from?: { name?: string; address: string } }) : {};
      let body = m.body ?? "";
      if (meta.mailbox) {
        try {
          const r = await graph<{ value: { body: { content: string } }[] }>(`/users/${q(meta.mailbox)}/messages?$filter=${encodeURIComponent(`internetMessageId eq '${m.externalId!.replace(/'/g, "''")}'`)}&$select=body`);
          const html = r.value[0]?.body?.content;
          if (html) body = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
        } catch {
          /* keep the preview */
        }
      }
      parts.push(`[${m.occurredAt.toISOString().slice(0, 10)}] ${m.direction === "OUTBOUND" ? "RJL" : company.name} (${meta.from?.name ?? meta.from?.address ?? ""}): ${m.subject ?? ""}\n${body}`);
    }
    scanned++;
    let out: z.infer<typeof Out> | null = null;
    try {
      const res = await client.messages.parse({ model: "claude-sonnet-5", max_tokens: 800, system: SYSTEM, messages: [{ role: "user", content: `Sponsor: ${company.name}\n\n${parts.join("\n\n")}` }], output_config: { format: zodOutputFormat(Out) } });
      out = res.parsed_output;
    } catch {
      out = null;
    }
    await prisma.mentionScan.create({ data: { externalId: newest.externalId!, companyId: company.id } }).catch(() => {});
    if (!out) continue;
    const existing = await prisma.deal.findMany({ where: { OR: [{ sponsorCompanyId: company.id }, { sponsorName: { contains: company.name.split(" ")[0], mode: "insensitive" } }] }, select: { name: true, propertyName: true } });
    // deals this firm was SENT (they sit on the progress report): when they write about one of those they are the
    // LP on it, never the sponsor of a new one. JDI writing about Everett is JDI the investor, not "JDI | Everett".
    const theirDeals = await prisma.deal.findMany({ where: { investors: { some: { contact: { companyId: company.id } } } }, select: { name: true, propertyName: true, city: true, state: true } });
    // and any live deal by that name, whoever sponsors it: one deal, one ticket
    const live = await prisma.deal.findMany({ where: { stage: { notIn: ["Deal Lost", "Deal Closed"] }, parentDealId: null }, select: { name: true, propertyName: true, city: true, state: true } });
    for (const d of out.deals) {
      if (!d.name.trim()) continue;
      if (existing.some((e) => fuzzyMatch(d.name, e.propertyName ?? e.name))) continue;
      if (theirDeals.some((e) => fuzzyMatch(d.name, e.propertyName ?? e.name) || nameContains(d.name, e.propertyName ?? e.name))) continue;
      if (live.some((e) => fuzzyMatch(d.name, e.propertyName ?? e.name) || nameContains(d.name, e.propertyName ?? e.name))) continue;
      const { findSameDeal } = await import("@/lib/deal-knowledge");
      const [city, state] = d.location.split(",").map((x) => x.trim());
      // same deal already on the board: same name, its street address, or the same sponsor in the same city (Claude confirms)
      if (await findSameDeal(d.name, undefined, { sponsorCompanyId: company.id, sponsorName: company.name, city: city || null, state: state || null, address: d.name, text: d.whatWasSaid })) continue;
      await prisma.deal.create({
        data: {
          name: `${company.name} | ${d.name}`,
          propertyName: d.name,
          sponsorName: company.name,
          sponsorCompanyId: company.id,
          stage: "Deal Mentioned",
          assetClass: d.assetClass || null,
          city: city || null,
          state: state && state.length === 2 ? state.toUpperCase() : null,
          summary: d.whatWasSaid,
          details: JSON.stringify({ mentionedIn: newest.subject, mentionedOn: newest.occurredAt.toISOString(), mentionedMessageId: newest.externalId, promised: d.promised }),
          updatedAt: newest.occurredAt,
        },
      });
      created.push(`${company.name}: ${d.name}`);
      existing.push({ name: d.name, propertyName: d.name });
    }
  }
  return { threads: scanned, created };
}

export { parseList };
