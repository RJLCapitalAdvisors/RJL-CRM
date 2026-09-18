import { prisma } from "@/lib/db";
import { AQ_DEAL_STAGES } from "@/lib/acquisitions";

const KEY = "aqDealStages";

/**
 * The Deal Pipeline's stages are data (Sep 18, 2026): Jonathan and Shawn add, rename and reorder them from the
 * pipeline page. Stored as a JSON list in Setting `aqDealStages`; the defaults in AQ_DEAL_STAGES apply until the
 * first edit. Order is the column order left to right.
 */
export async function getAqDealStages(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (row?.value) {
    try {
      const v = JSON.parse(row.value) as unknown;
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && x.trim())) return v as string[];
    } catch {
      /* fall through to the defaults */
    }
  }
  return [...AQ_DEAL_STAGES];
}

export async function saveAqDealStages(list: string[]) {
  const clean = list.map((x) => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
  if (!clean.length) throw new Error("The pipeline needs at least one stage.");
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(clean) }, update: { value: JSON.stringify(clean) } });
  return clean;
}
