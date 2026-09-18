import { prisma } from "@/lib/db";
import type { Workspace } from "@/lib/access";

/**
 * Data rules (Sep 18, 2026): what a person has taught the Ask the CRM assistant about reading their files, one rule
 * per line, kept per side under Settings > Data rules. Shawn dumps spreadsheets of properties into the Acquisitions
 * assistant and tells it how to read them ("column C is the neighborhood", "skip rows with no phone"); the
 * assistant saves each lesson here with save_rule and reads the whole list before every file. Jonathan and Shawn
 * edit the list by hand on the page, including pasting a batch of rules at once.
 */
export const dataRulesKey = (w: Workspace) => `dataRules:${w}`;

export async function loadDataRules(w: Workspace): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: dataRulesKey(w) } }).catch(() => null);
  return (row?.value ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function dataRulesText(w: Workspace): Promise<{ text: string; savedAt: Date | null }> {
  const row = await prisma.setting.findUnique({ where: { key: dataRulesKey(w) } }).catch(() => null);
  return { text: row?.value ?? "", savedAt: row?.updatedAt ?? null };
}

export async function saveDataRulesText(w: Workspace, text: string) {
  const clean = text.replace(/\r\n/g, "\n").trimEnd();
  await prisma.setting.upsert({ where: { key: dataRulesKey(w) }, update: { value: clean }, create: { key: dataRulesKey(w), value: clean } });
}

/** Add one rule (from the assistant's save_rule, or the page). Duplicates, ignoring case and trailing periods, are not added twice. */
export async function appendDataRule(w: Workspace, rule: string): Promise<{ added: boolean; rules: string[] }> {
  const line = rule.replace(/\s+/g, " ").trim();
  if (!line) return { added: false, rules: await loadDataRules(w) };
  const rules = await loadDataRules(w);
  const norm = (s: string) => s.toLowerCase().replace(/[.\s]+$/, "");
  if (rules.some((r) => norm(r) === norm(line))) return { added: false, rules };
  const next = [...rules, line];
  await saveDataRulesText(w, next.join("\n"));
  return { added: true, rules: next };
}
