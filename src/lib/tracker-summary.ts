import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { stripDashes } from "@/lib/style";
import { investorLabel, statusOf } from "@/lib/tracker";

/**
 * "Notable Feedback Themes" and "Items Needed from Sponsor" for a progress report, written from the
 * investor notes the same way the Google Docs versions were: short, factual, each theme naming the
 * firm(s) behind it in parentheses, each item naming who asked for it.
 */
const Out = z.object({
  themes: z.array(z.string()).describe('Notable feedback themes, at most 4, each under 15 words, ending with the firm name(s) in parentheses, e.g. "Deal size flagged as too small by more than one group (Slate, Prospect Ridge)". Group similar objections into one theme. Empty if there is no substantive feedback yet.'),
  items: z.array(z.string()).describe('Items the sponsor still owes, at most 4, each under 12 words, e.g. "Argus model in Argus 14.0 format (Corebridge, MLG Capital)". Taken ONLY from the Open requests list (those are the asks not yet answered); never from the notes, which may mention requests already fulfilled. Empty when the Open requests list is empty.'),
});

const SYSTEM = `You maintain investor progress reports for RJL Capital Advisors, a real estate capital advisory firm. You are given the investor rows of one report (firm, status, note). Write the "Notable Feedback Themes" and "Items Needed from Sponsor" sections exactly in the house style: plain, factual, analyst tone, no marketing language, no speculation beyond what the notes say. Themes summarize why groups passed or hesitated and what interested groups are focused on; each ends with the firm(s) in parentheses. Items are concrete deliverables the sponsor still owes (models, rent rolls, calls to schedule, answers to questions), each with the requesting firm(s) in parentheses, and they come only from the Open requests list: a request that appears in a note but not in that list has been dealt with and must not be listed. Skip rows with no note. Do not restate statuses. Be terse: fragments, not full sentences; one clause per theme; never explain or editorialize. Match this register exactly: "Occupancy and asset vintage flagged as a concern (Hamilton Lane)", "Argus model requested by multiple groups (Corebridge, MLG Capital)", "Return underwriting fell short of minimum thresholds for one group (Blue Vista)". Use the firm names as given.`;

export async function generateTrackerSummary(dealId: string): Promise<{ themes: string[]; items: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { investors: { include: { contact: { include: { company: true } } } } } });
  if (!deal) return null;
  const rows = deal.investors.filter((r) => r.note?.trim()).map((r) => `- ${investorLabel(r.contact)} | ${statusOf(r.status).label} | ${r.note!.trim()}`);
  // what LPs asked the sponsor for and have not received (open LP requests on Deal momentum) are items too
  const asks = await prisma.momentum.findMany({ where: { dealId, kind: "LP_ASK", status: "OPEN" }, select: { party: true, summary: true } });
  const askRows = asks.map((m) => `- ${m.party} asked for: ${m.summary.replace(/^.*?asks:\s*/, "").split(" | Already on the ticket:")[0]}`);
  if (rows.length === 0 && askRows.length === 0) {
    await prisma.deal.update({ where: { id: dealId }, data: { trackerSummaryAt: new Date() } }).catch(() => null);
    return { themes: [], items: [] };
  }
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `Deal: ${deal.propertyName ?? deal.name}\nSponsor: ${deal.sponsorName ?? ""}\nAsset class: ${deal.assetClass ?? ""}\n\nInvestor rows:\n${rows.join("\n") || "(no notes yet)"}\n\nOpen requests from investors:\n${askRows.join("\n") || "(none)"}` }],
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
