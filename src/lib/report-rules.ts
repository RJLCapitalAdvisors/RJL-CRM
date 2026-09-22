import { prisma } from "@/lib/db";

/**
 * Progress report rules (Sep 22, 2026): how the RJL Capital Advisors progress reports are kept, one rule per line,
 * edited under Settings > Data rules. The code enforces the mechanical ones (statuses, pruning, bullets); the
 * list is also read into the prompts that write notes, themes and Items Needed, so a rule added here changes the
 * next report. The defaults below are the rules as Jonathan gave them; they show until the list is edited.
 */
export const REPORT_RULES_KEY = "reportRules:CA";

export const DEFAULT_REPORT_RULES: string[] = [
  "Statuses print and sort by rank: Term Sheet Issued 9 at the top, then Intro Made 8, Interested 7, Taking A Look 6, Followed Up 5, Deal Sent 4, Deal Not Sent 3, and Not A Fit 2 and Pass 1 always at the bottom.",
  "A pass in an investor's email always moves the row to Pass, whatever the row said before, including after an intro call or a term sheet.",
  "Other responses only move a row forward, and never past Intro Made on their own.",
  "Once a group passes or is not a fit, the row keeps only the reason for the pass; earlier notes come off the report and go to the deal log.",
  "Every note entry is one bullet, dated in parentheses, oldest first.",
  "What an investor asks the sponsor for is written on the row as Requested: followed by the asks, and listed under Items Needed from Sponsor until the sponsor answers.",
  "A group that passed, is not a fit, or has issued a term sheet is owed nothing: none of its requests appear in Items Needed from Sponsor.",
  "When an intro call with a group has happened (a Fireflies recording or a past calendar meeting with the group and the sponsor), the row moves to Intro Made and notes from before the call come off the report; notes from the call onward stay.",
  "Notes carry the investor's actual reasoning in their words, lightly cleaned; no status language, no pleasantries, no dashes.",
  "Notable Feedback Themes: at most four, each under 15 words, ending with the firm names in parentheses; similar objections grouped into one theme.",
  "Items Needed from Sponsor: concrete deliverables the sponsor still owes, each naming the firms asking; a numbered list of questions from one firm is one item per question.",
  "Never name one investor's terms or position to another; a term sheet's contents stay off the report.",
];

export async function loadReportRules(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: REPORT_RULES_KEY } }).catch(() => null);
  const lines = (row?.value ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : DEFAULT_REPORT_RULES;
}

export async function reportRulesText(): Promise<{ text: string; savedAt: Date | null }> {
  const row = await prisma.setting.findUnique({ where: { key: REPORT_RULES_KEY } }).catch(() => null);
  return { text: row?.value?.trim() ? row.value : DEFAULT_REPORT_RULES.join("\n"), savedAt: row?.updatedAt ?? null };
}

export async function saveReportRulesText(text: string) {
  const clean = text.replace(/\r\n/g, "\n").trimEnd();
  await prisma.setting.upsert({ where: { key: REPORT_RULES_KEY }, update: { value: clean }, create: { key: REPORT_RULES_KEY, value: clean } });
}
