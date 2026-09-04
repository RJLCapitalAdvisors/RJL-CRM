import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { investorLabel, statusOf } from "@/lib/tracker";

/**
 * "Notable Feedback Themes" and "Items Needed from Sponsor" for a progress report, written from the
 * investor notes the same way the Google Docs versions were: short, factual, each theme naming the
 * firm(s) behind it in parentheses, each item naming who asked for it.
 */
const Out = z.object({
  themes: z.array(z.string()).describe('Notable feedback themes, at most 4, each under 15 words, ending with the firm name(s) in parentheses, e.g. "Deal size flagged as too small by more than one group (Slate, Prospect Ridge)". Group similar objections into one theme. Empty if there is no substantive feedback yet.'),
  items: z.array(z.string()).describe('Items the sponsor must provide, at most 4, each under 12 words, e.g. "Argus model in Argus 14.0 format (Corebridge, MLG Capital)". Only documents, data, or calls investors asked for. Empty if none.'),
});

const SYSTEM = `You maintain investor progress reports for RJL Capital Advisors, a real estate capital advisory firm. You are given the investor rows of one report (firm, status, note). Write the "Notable Feedback Themes" and "Items Needed from Sponsor" sections exactly in the house style: plain, factual, analyst tone, no marketing language, no speculation beyond what the notes say. Themes summarize why groups passed or hesitated and what interested groups are focused on; each ends with the firm(s) in parentheses. Items are concrete deliverables the sponsor owes (models, rent rolls, calls to schedule, answers to questions), each with the requesting firm(s) in parentheses. Skip rows with no note. Do not restate statuses. Be terse: fragments, not full sentences; one clause per theme; never explain or editorialize. Match this register exactly: "Occupancy and asset vintage flagged as a concern (Hamilton Lane)", "Argus model requested by multiple groups (Corebridge, MLG Capital)", "Return underwriting fell short of minimum thresholds for one group (Blue Vista)". Use the firm names as given.`;

export async function generateTrackerSummary(dealId: string): Promise<{ themes: string[]; items: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { investors: { include: { contact: { include: { company: true } } } } } });
  if (!deal) return null;
  const rows = deal.investors.filter((r) => r.note?.trim()).map((r) => `- ${investorLabel(r.contact)} | ${statusOf(r.status).label} | ${r.note!.trim()}`);
  if (rows.length === 0) return { themes: [], items: [] };
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `Deal: ${deal.propertyName ?? deal.name}\nSponsor: ${deal.sponsorName ?? ""}\nAsset class: ${deal.assetClass ?? ""}\n\nInvestor rows:\n${rows.join("\n")}` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  if (!res.parsed_output) return null;
  const out = res.parsed_output;
  await prisma.deal.update({ where: { id: dealId }, data: { trackerThemes: out.themes.join("\n") || null, trackerItemsNote: out.items.join("\n") || null } });
  return out;
}
