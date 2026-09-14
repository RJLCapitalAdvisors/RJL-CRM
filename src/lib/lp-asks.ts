import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isSponsorSide } from "@/lib/report-guard";
import { graph } from "@/lib/graph";
import { ACTIVE_STAGES, isBlindIntro, isLegacyIntroTicket } from "@/lib/taxonomy";
import { mergeNote } from "@/lib/tracker";
import { stripDashes } from "@/lib/style";
import { houseSubjectMatches, subjectMatchesDeal } from "@/lib/deal-match";

/**
 * When an LP replies to a deal asking for something (a 5-year model, the sponsor's markets, a rent roll),
 * that request is the sponsor's to answer. We read inbound LP emails on active deals, pull out the asks,
 * put them at the top of Deal momentum as an LP_ASK item whose Handle drafts the request email to the
 * sponsor, note them on the progress report, and move the LP to "Taking A Look" if they were still quiet.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 14;
const q = (s: string) => encodeURIComponent(s);

const Out = z.object({
  asks: z.array(z.string()).describe("Each thing the investor asked for from the sponsor or RJL, as a short imperative line, e.g. '5-year model', 'Which markets BrightStar operates in'. Never name the person who wrote; say the firm or nothing. Empty if the email asks for nothing."),
  stance: z.enum(["reviewing", "interested", "pass", "unclear"]).describe("Where the investor stands after this email."),
  note: z.string().describe("One line for the progress report the sponsor will read. Its value is the actual reason the investor passed, declined or hesitated (wrong mandate, timing, asset class fit, size, market, structure), so relay their real reasoning, not just the outcome. Only what the investor actually said, lightly cleaned up for grammar; no generic status language like 'awaiting response' (that is the status column). Strip pleasantries and filler (hi, hope you are well, thanks for sharing, keep us posted). Empty if there was no substantive response, an auto-reply, or only an acknowledgement. No dashes as punctuation."),
  dealIndex: z.number().int().describe("Index in the DEALS list of the deal this email is about. -1 if it is about a different deal, an intro, a general catch-up, or unclear. Never guess: an email that does not identify the deal is -1."),
});

export type LpAsk = { dealId: string; lpCompanyId: string; lpName: string; asks: string[]; answered: { ask: string; answer: string }[]; note: string; stance: string; messageId: string; contactId: string | null; at: Date };

export async function detectLpAsks(): Promise<LpAsk[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  const inbound = await prisma.activity.findMany({
    // recent replies, plus any older reply already tied to a live deal that has never been read (Refresh responses ties them)
    where: { type: "EMAIL", direction: "INBOUND", externalId: { not: null }, contactId: { not: null }, companyId: { not: null }, OR: [{ occurredAt: { gte: since } }, { dealId: { not: null }, occurredAt: { gte: new Date(Date.now() - 180 * DAY) } }] },
    include: { contact: { select: { id: true, companyId: true, firstName: true, lastName: true } }, company: { select: { id: true, name: true, domain: true } } },
    orderBy: { occurredAt: "desc" },
  });
  const out: LpAsk[] = [];
  const client = new Anthropic();
  for (const a of inbound) {
    if (await prisma.lpAskScan.findUnique({ where: { externalId: a.externalId! } })) continue;
    // which deal: the deals this firm was sent (active, on the report), then the one the email itself names.
    // A firm on several deals answers each on its own thread; an email that names none of them is about
    // something else (an intro, another deal) and must not be pinned to any ticket.
    const rows = await prisma.dealInvestor.findMany({ where: { contact: { companyId: a.companyId! }, deal: { stage: { in: [...ACTIVE_STAGES] } }, status: { gte: 2 } }, include: { deal: { select: { id: true, propertyName: true, name: true, city: true, state: true, requestedAmount: true, sponsorName: true } } }, orderBy: { updatedAt: "desc" } });
    const legacyIntro = (x: { id: string }) => legacy.has(x.id);
    const candidatesAll = rows.map((r) => r.deal).filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
    const legacy = new Set((await prisma.deal.findMany({ where: { id: { in: candidatesAll.map((x) => x.id) }, stage: "Intro To Capital Made", hubspotId: { not: null } }, select: { id: true, hubspotId: true, stage: true, sponsorCompany: { select: { roles: true } }, _count: { select: { investors: true } } } })).filter((x) => isLegacyIntroTicket({ ...x, sponsorRoles: x.sponsorCompany?.roles ?? null, investorCount: x._count.investors })).map((x) => x.id));
    const blind = new Set((await prisma.deal.findMany({ where: { id: { in: candidatesAll.map((x) => x.id) }, hubspotId: { not: null } }, select: { id: true, name: true, propertyName: true, propertyAddress: true, hubspotId: true, _count: { select: { files: true, facts: true } } } })).filter((x) => isBlindIntro({ ...x, fileCount: x._count.files, factCount: x._count.facts })).map((x) => x.id));
    const candidates = candidatesAll.filter((x) => !legacyIntro(x) && !blind.has(x.id));
    if (a.dealId && !candidates.some((x) => x.id === a.dealId)) {
      // the deal the email log pinned, unless it is a legacy intro record (those are never tickets)
      const linked = await prisma.deal.findFirst({ where: { id: a.dealId, stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, propertyName: true, name: true, city: true, state: true, requestedAmount: true, sponsorName: true, hubspotId: true, stage: true, sponsorCompany: { select: { roles: true } }, _count: { select: { investors: true } } } });
      if (linked && !isLegacyIntroTicket({ ...linked, sponsorRoles: linked.sponsorCompany?.roles ?? null, investorCount: linked._count.investors })) candidates.unshift(linked);
    }
    // the deals this firm sits on (the report rows) come first; a record that only came from the mention detector
    // ("Deal Mentioned", nobody on its report) never outranks the ticket the firm was actually sent
    const onReport = new Set(rows.map((r) => r.dealId));
    const stageOf = new Map((await prisma.deal.findMany({ where: { id: { in: candidates.map((x) => x.id) } }, select: { id: true, stage: true } })).map((x) => [x.id, x.stage]));
    const preferReal = (list: typeof candidates) => [...list].sort((x, y) => Number(onReport.has(y.id)) - Number(onReport.has(x.id)) || Number(stageOf.get(x.id) === "Deal Mentioned") - Number(stageOf.get(y.id) === "Deal Mentioned"));
    const byName = preferReal(candidates.filter((x) => subjectMatchesDeal(a.subject, x) || houseSubjectMatches(a.subject, x)));
    let dealId: string | null = a.dealId && candidates.some((x) => x.id === a.dealId) && (onReport.has(a.dealId) || stageOf.get(a.dealId) !== "Deal Mentioned" || !byName.length) ? a.dealId : null;
    if (!dealId) dealId = byName[0]?.id ?? null;
    // the sponsor answering about their own deal is not an LP response
    const sponsorOf = await prisma.deal.findFirst({ where: { sponsorCompanyId: a.companyId!, stage: { in: [...ACTIVE_STAGES] } }, select: { id: true } });
    if (sponsorOf && !candidates.some((x) => x.id !== sponsorOf.id)) {
      await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: "sponsor" } }).catch(() => {});
      continue;
    }
    if (!candidates.length) {
      await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: "no-deal" } }).catch(() => {});
      continue;
    }
    // full body from the mailbox that has it
    let body = a.body ?? "";
    const meta = a.meta ? (JSON.parse(a.meta) as { mailbox?: string; to?: { address: string; name?: string }[]; cc?: { address: string; name?: string }[] }) : {};
    if (meta.mailbox) {
      try {
        const r = await graph<{ value: { body: { content: string } }[] }>(`/users/${q(meta.mailbox)}/messages?$filter=internetMessageId eq '${a.externalId!.replace(/'/g, "''")}'&$select=body`);
        const html = r.value[0]?.body?.content;
        if (html) body = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
      } catch {
        /* preview only */
      }
    }
    let parsed: z.infer<typeof Out> | null = null;
    try {
      const list = candidates.map((x, i) => `${i}. ${x.propertyName ?? x.name}${x.city ? ` (${x.city})` : ""} - sponsor ${x.sponsorName ?? "unknown"}`).join("\n");
      const known = dealId ? `The subject line ties this email to deal ${candidates.findIndex((x) => x.id === dealId)} - use that index unless the body plainly contradicts it.` : "The subject line does not name any of these deals: pick the index only if the body clearly identifies one of them, otherwise -1.";
      const res = await client.messages.parse({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system: `An investor (LP) emailed RJL Capital Advisors, a real estate capital advisor that has sent them the deals listed under DEALS. Decide which deal the email is about (${known}) and extract what they asked for and where they stand on that deal. Only real requests; ignore pleasantries. If the email is an auto-reply or out-of-office, return no asks and stance unclear.`,
        messages: [{ role: "user", content: `DEALS:\n${list}\n\nFrom ${a.company?.name} (${[a.contact?.firstName, a.contact?.lastName].filter(Boolean).join(" ")}), subject "${a.subject ?? ""}":\n\n${body}` }],
        output_config: { format: zodOutputFormat(Out) },
      });
      parsed = res.parsed_output;
    } catch {
      parsed = null;
    }
    if (parsed && !dealId) dealId = candidates[parsed.dealIndex]?.id ?? null;
    if (!dealId) {
      await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: parsed ? "other-deal" : "error" } }).catch(() => {});
      continue;
    }
    await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: parsed ? `${parsed.asks.length} asks` : "error" } }).catch(() => {});
    // what they said about their own program ("too small for us", "not our market") goes to Data updates as a criteria proposal
    if (parsed && (parsed.stance === "pass" || parsed.note)) {
      const { proposeCriteriaChanges } = await import("@/lib/criteria-proposals");
      await proposeCriteriaChanges({ companyId: a.companyId!, contactId: a.contactId, text: body, source: "EMAIL", sourceRef: a.externalId }).catch(() => null);
    }
    if (!parsed) continue;
    // progress report: note + status
    const dateTag = a.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    let reportRows = await prisma.dealInvestor.findMany({ where: { dealId, contact: { companyId: a.companyId! } } });
    if (!reportRows.length && a.contactId) {
      // the firm answered a deal email but was never put on the report (sent by hand): add it as Deal Sent first
      if (!(await isSponsorSide(dealId, a.contactId))) await prisma.dealInvestor.create({ data: { dealId, contactId: a.contactId, status: 2, updatedAt: a.occurredAt } }).catch(() => null);
      reportRows = await prisma.dealInvestor.findMany({ where: { dealId, contactId: a.contactId } });
    }
    // Rule: a real reply from an LP means they are looking at it. Confirming receipt is Taking a look, not Sent awaiting
    // response. Only an auto-reply or out-of-office leaves the status alone.
    const autoReply = /^(?:\s*(?:re|fw|fwd)\s*:\s*)*(automatic reply|auto-?reply|autoreply|out of (?:the )?office)/i.test(a.subject ?? "") || /^\s*(i am|i'm) (currently )?out of (the )?office/i.test(body);
    const newStatus = parsed.stance === "pass" ? 8 : parsed.stance === "interested" ? 5 : autoReply ? null : 4;
    // "looping in Sarah": colleagues at the LP's firm on the reply join the row (and the CRM), so the next email reaches them too
    const loopedIn = await loopInColleagues(a.companyId!, a.company?.domain ?? null, a.contactId, [...(meta.to ?? []), ...(meta.cc ?? [])]).catch(() => [] as string[]);
    // A note is written only on the deal it is about. If the LP's words name a different deal the firm is on
    // (its property or its city) and not this one, the note stays off this report; the status still moves.
    const noteText = stripDashes(parsed.note ?? "").trim();
    const here = candidates.find((x) => x.id === dealId);
    const names = (x: { propertyName: string | null; name: string; city: string | null }) => [x.propertyName ?? x.name, x.city].filter((w): w is string => Boolean(w && w.trim().length >= 5)).map((w) => w.toLowerCase());
    const mentionsHere = here ? names(here).some((w) => noteText.toLowerCase().includes(w)) : false;
    const mentionsOther = candidates.filter((x) => x.id !== dealId).some((x) => names(x).some((w) => noteText.toLowerCase().includes(w)));
    const noteForThisDeal = noteText && !(mentionsOther && !mentionsHere) ? noteText : "";
    for (const r of reportRows) {
      const cleaned = noteForThisDeal;
      const note = cleaned && !/^(confirmed receipt|acknowledged|received|thanks?)\b/i.test(cleaned) ? `${cleaned} (${dateTag})` : null;
      const extras = new Set<string>([...(r.extraContactIds ? (JSON.parse(r.extraContactIds) as string[]) : []), ...loopedIn.filter((id) => id !== r.contactId)]);
      await prisma.dealInvestor.update({ where: { id: r.id }, data: { ...(note ? { note: mergeNote(r.note, note), noteDate: a.occurredAt } : {}), ...(newStatus && newStatus > r.status && r.status < 6 ? { status: newStatus } : {}), ...(loopedIn.length ? { extraContactIds: JSON.stringify([...extras]) } : {}), updatedAt: a.occurredAt } });
    }
    if (parsed.asks.length) {
      // anything the sponsor already told us (Questions answered on the ticket) gets surfaced with the ask
      const { factsFor } = await import("@/lib/deal-knowledge");
      const answered: { ask: string; answer: string }[] = [];
      for (const ask of parsed.asks) {
        const hit = (await factsFor(dealId, ask, 1))[0];
        if (hit) answered.push({ ask, answer: hit.answer });
      }
      out.push({ dealId, lpCompanyId: a.companyId!, lpName: a.company!.name, asks: parsed.asks, answered, note: parsed.note, stance: parsed.stance, messageId: a.externalId!, contactId: a.contactId, at: a.occurredAt });
    }
  }
  return out;
}


/** People at the LP's firm on the reply who are not the sender: known ones are returned, new ones are created under the firm. */
async function loopInColleagues(companyId: string, domain: string | null, senderContactId: string | null, parties: { address: string; name?: string }[]): Promise<string[]> {
  const out: string[] = [];
  const dom = domain?.toLowerCase() ?? null;
  for (const p of parties) {
    const email = p.address?.toLowerCase();
    if (!email || /@(rjlcapadvisors|rjlequities)\.com$/i.test(email)) continue;
    if (dom && !email.endsWith(`@${dom}`)) continue;
    if (!dom) continue;
    const existing = await prisma.contact.findUnique({ where: { email }, select: { id: true, companyId: true } });
    if (existing) {
      if (existing.id !== senderContactId) out.push(existing.id);
      if (!existing.companyId) await prisma.contact.update({ where: { id: existing.id }, data: { companyId } }).catch(() => null);
      continue;
    }
    const parts = (p.name ?? "").replace(/["']/g, "").split(/\s+/).filter(Boolean);
    const created = await prisma.contact.create({ data: { email, firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null, companyId } }).catch(() => null);
    if (created) out.push(created.id);
  }
  return out;
}
