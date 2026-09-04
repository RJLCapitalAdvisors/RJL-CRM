/* Remap check sizes and vintages in every criteria row to the new buckets. Re-runnable. */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { CHECK_SIZE_MIGRATION, VINTAGE_MIGRATION, parseList, toJson } from "../src/lib/taxonomy";

(async () => {
  const rows = await prisma.investorCriteria.findMany({ select: { id: true, checkSizes: true, vintages: true } });
  let changed = 0;
  for (const r of rows) {
    const cs = toJson(parseList(r.checkSizes).flatMap((v) => CHECK_SIZE_MIGRATION[v] ?? [v]));
    const vt = toJson(parseList(r.vintages).map((v) => VINTAGE_MIGRATION[v] ?? v));
    if (cs !== r.checkSizes || vt !== r.vintages) {
      await prisma.investorCriteria.update({ where: { id: r.id }, data: { checkSizes: cs, vintages: vt } });
      changed++;
    }
  }
  console.log(`criteria rows: ${rows.length}, remapped: ${changed}`);
  const sample = await prisma.investorCriteria.findFirst({ where: { NOT: { checkSizes: "[]" } }, select: { checkSizes: true, vintages: true } });
  console.log("sample:", sample);
  await prisma.$disconnect();
})();
