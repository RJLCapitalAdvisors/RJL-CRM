import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { stripDashes } from "@/lib/style";
import { investorLabel, owedNothing, statusOf } from "@/lib/tracker";
import { loadReportRules } from "@/lib/report-rules";

/**
 * "Notable Feedback Themes" and "Items Needed from Sponsor" for a progress report, written from the
 * investor notes the same way the Google Docs versions were: short, factual, each theme naming the
 * firm(s) behind it in parentheses, each item naming who asked for it.
 */
const Out = z.object({
  themes: z.array(z.string()).describe('Notable feedback themes, at most 4, each under 15 words, ending with the firm name(s) in parentheses, e.g. "Deal size flagged as too small by more than one group (Slate, Prospect Ridge)". Group similar objections into one theme. Empty if there is no substantive feedback yet.'),
  items: z.array(z.string()).describe('Items the sponsor still owes, each under 14 words, e.g. "Argus model in Argus 14.0 format (Corebridge, MLG Capital)". Taken ONLY from the Outstanding requests list; never from the notes, which may mention requests already fulfilled. List every outstanding request, grouping the same ask from several firms into one item with the firms in parentheses; when a firm sent a numbered list of questions, each question is its own item. Empty when the list is empty.'),
});

const SYSTEM = `You maintain investor progress reports for RJL Capital Advisors, a real estate capital advisory firm. You are given the investor rows of one report (firm, status, note). Write the "Notable Feedback Themes" and "Items Needed from Sponsor" sections exactly in the house style: plain, factual, analyst tone, no marketing language, no speculation beyond what the notes say. Themes summarize why groups passed or hesitated and what interested groups are focused on; each ends with the firm(s) in parentheses. Items are concrete deliverables the sponsor still owes (models, rent rolls, calls to schedule, answers to questions), each with the requesting firm(s) in parentheses, and they come only from the Outstanding requests list: a request that appears in a note but not in that list has been dealt with and must not be listed. Every outstanding request is listed, one per line. A group whose status is Not A Fit, Pass or Term Sheet Issued is owed nothing: none of its requests appear in Items Needed; a theme may still cite a passed group for why it passed, and a term sheet group for what it is focused on. When the message carries sections written by hand, keep that wording as the base and change only what the notes and requests require. Skip rows with no note. Do not restate statuses. Be terse: fragments, not full sentences; one clause per theme; never explain or editorialize. Match this register exactly: "Occupancy and asset vintage flagged as a concern (Hamilton Lane)", "Argus model requested by multiple groups (Corebridge, MLG Capital)", "Return underwriting fell short of minimum thresholds for one group (Blue Vista)". Use the firm names as given.`;

export async function generateTrackerSummary(dealId: string): Promise<{ themes: string[]; items: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { investors: { include: { contact: { include: { company: true } } } } } });
  if (!deal) return null;
  const rows = deal.investors.filter((r) => r.note?.trim()).map((r) => `- ${investorLabel(r.contact)} | ${statusOf(r.status).label} | ${r.note!.trim()}`);
  // a group that passed or is not a fit is owed nothing: its requests leave Items Needed from Sponsor (Jonathan, Sep 17)
  const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const passedNames = deal.investors.filter((r) => owedNothing(r.status)).flatMap((r) => [norm(r.contact.company?.name), norm(investorLabel(r.contact))]).filter((x) => x.length >= 3);
  const fromPassed = (party: string) => { const q = norm(party); return q.length >= 3 && passedNames.some((n) => n === q || n.includes(q) || q.includes(n)); };
  // what LPs asked the sponsor for and have not received. Dismissing or handling the Deal momentum item only quiets
  // the dashboard; the sponsor still owes the answer, so the ask stays here until the ticket answers it.
  const asks = await prisma.momentum.findMany({ where: { dealId, kind: "LP_ASK", updatedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, select: { party: true, summary: true } });
  const { parseAsks } = await import("@/lib/momentum");
  const askRows = asks.filter((m) => !fromPassed(m.party)).map((m) => ({ party: m.party, asks: parseAsks(m.summary).asks })).filter((m) => m.asks.length).map((m) => `- ${m.party} asked for: ${m.asks.join("; ")}`);
  // text Jonathan wrote by hand is the text: the writer keeps it and only adjusts it
  const manualBlock = deal.trackerManualAt
    ? `\n\nCurrent sections, written by hand by RJL on ${deal.trackerManualAt.toISOString().slice(0, 10)} (keep this wording; only drop items that are now answered or were asked only by groups who passed or are not a fit, and only add themes or items the notes and requests above bring in):\nThemes:\n${(deal.trackerThemes ?? "").split("\n").filter(Boolean).map((x) => `- ${x}`).join("\n") || "(none)"}\nItems:\n${(deal.trackerItemsNote ?? "").split("\n").filter(Boolean).map((x) => `- ${x}`).join("\n") || "(none)"}`
    : "";
  if (rows.length === 0 && askRows.length === 0) {
    await prisma.deal.update({ where: { id: dealId }, data: { trackerSummaryAt: new Date() } }).catch(() => null);
    return { themes: [], items: [] };
  }
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1500,
    system: `${SYSTEM}\n\nHouse rules for progress reports (Settings > Data rules; follow every one):\n${(await loadReportRules()).map((r) => "- " + r).join("\n")}`,
    messages: [{ role: "user", content: `Deal: ${deal.propertyName ?? deal.name}\nSponsor: ${deal.sponsorName ?? ""}\nAsset class: ${deal.assetClass ?? ""}\n\nInvestor rows:\n${rows.join("\n") || "(no notes yet)"}\n\nOutstanding requests from investors (the sponsor has not answered these):\n${askRows.join("\n") || "(none)"}${manualBlock}` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  if (!res.parsed_output) return null;
  const out = { themes: res.parsed_output.themes.map((x) => stripDashes(x)), items: res.parsed_output.items.map((x) => stripDashes(x)) };
  await prisma.deal.update({ where: { id: dealId }, data: { trackerThemes: out.themes.join("\n") || null, trackerItemsNote: out.items.join("\n") || null, trackerSummaryAt: new Date() } });
  return out;
}

/**
 * Themes and items are rewritten whenever the report has moved since they were last written (a new note, an
 * LP request), so the PDF and the sponsor's copy never go out with the sections blank or stale. A hand edit on
 * the tracker page counts as fresh until the next change.
 */
export async function ensureTrackerSummary(dealId: string): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { trackerSummaryAt: true, investors: { where: { note: { not: null } }, select: { updatedAt: true, noteDate: true } } } });
  if (!deal) return;
  const [askMax, noteMax] = await Promise.all([
    prisma.momentum.aggregate({ where: { dealId, kind: "LP_ASK" }, _max: { updatedAt: true } }),
    Promise.resolve(deal.investors.reduce<Date | null>((m, r) => { const t = r.noteDate ?? r.updatedAt; return !m || t > m ? t : m; }, null)),
  ]);
  const latest = [noteMax, askMax._max.updatedAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return; // nothing to summarize yet
  if (deal.trackerSummaryAt && deal.trackerSummaryAt >= latest) return; // still current
  await generateTrackerSummary(dealId).catch((e) => console.error("tracker summary failed", e));
}
