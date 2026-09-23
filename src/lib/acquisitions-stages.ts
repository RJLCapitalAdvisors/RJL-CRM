import { prisma } from "@/lib/db";
import { AQ_PIPELINES, type AqPipeline } from "@/lib/acquisitions";

/**
 * A pipeline's stages are data (Sep 18, 2026; three pipelines since Sep 23): Jonathan and Shawn add, rename and reorder
 * them from the board (Edit stages). Stored as a JSON list in the pipeline's Setting (aqBuyerStages, aqOperatorStages,
 * aqDealStages); the defaults in AQ_PIPELINES apply until the first edit. Order is the column order left to right.
 */
export async function getAqStages(pipeline: AqPipeline): Promise<string[]> {
  const def = AQ_PIPELINES[pipeline];
  const row = await prisma.setting.findUnique({ where: { key: def.setting } }).catch(() => null);
  if (row?.value) {
    try {
      const v = JSON.parse(row.value) as unknown;
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && x.trim())) return v as string[];
    } catch {
      /* fall through to the defaults */
    }
  }
  return [...def.defaults];
}

export async function saveAqStages(pipeline: AqPipeline, list: string[]) {
  const key = AQ_PIPELINES[pipeline].setting;
  const clean = list.map((x) => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
  if (!clean.length) throw new Error("The pipeline needs at least one stage.");
  await prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(clean) }, update: { value: JSON.stringify(clean) } });
  return clean;
}

export const getAqDealStages = () => getAqStages("deals");
export const saveAqDealStages = (list: string[]) => saveAqStages("deals", list);
