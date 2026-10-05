import { prisma } from "@/lib/db";

/**
 * Standing import instructions for RJL Acquisitions (Oct 5, 2026): the set of directions Shawn gives Ask the CRM once
 * for every call-list export he drops in ("one row per phone number, fold them by parcel", "a row marked WN is a wrong
 * number", "put the Terakotta list name in Source List"). Kept whole in a Setting, read before every file, and shown
 * for viewing and editing under Settings > Import instructions. Data rules (one-line lessons) sit beside them.
 */
export const IMPORT_INSTRUCTIONS_KEY = "importInstructions:AQ";

export async function importInstructionsText(): Promise<{ text: string; savedAt: Date | null }> {
  const row = await prisma.setting.findUnique({ where: { key: IMPORT_INSTRUCTIONS_KEY } }).catch(() => null);
  return { text: row?.value ?? "", savedAt: row?.updatedAt ?? null };
}

export async function saveImportInstructionsText(text: string) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  await prisma.setting.upsert({ where: { key: IMPORT_INSTRUCTIONS_KEY }, update: { value: clean }, create: { key: IMPORT_INSTRUCTIONS_KEY, value: clean } });
  return clean;
}

/** From the assistant's save_import_instructions: replace the whole set, or add to it. */
export async function updateImportInstructions(text: string, mode: "replace" | "append"): Promise<string> {
  const incoming = text.replace(/\r\n/g, "\n").trim();
  if (!incoming) return (await importInstructionsText()).text;
  if (mode === "replace") return saveImportInstructionsText(incoming);
  const cur = (await importInstructionsText()).text;
  return saveImportInstructionsText(cur ? `${cur}\n${incoming}` : incoming);
}
