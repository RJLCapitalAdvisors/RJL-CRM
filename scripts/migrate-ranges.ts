/** Fill checkMin/Max, holdMin/Max, vintageMin/Max from the legacy bucket lists. Re-runnable; only touches rows with empty ranges. */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseList } from "../src/lib/taxonomy";
import { checkRangeFrom, holdRangeFrom, vintageRangeFrom } from "../src/lib/ranges";
(async () => {
  const rows = await prisma.investorCriteria.findMany({ where: { checkMinMM: null, holdMinYears: null, vintageMin: null } });
  let n = 0;
  for (const r of rows) {
    const c = checkRangeFrom(parseList(r.checkSizes)), h = holdRangeFrom(parseList(r.holdPeriods)), v = vintageRangeFrom(parseList(r.vintages));
    if (!c && !h && !v) continue;
    await prisma.investorCriteria.update({ where: { id: r.id }, data: { checkMinMM: c?.[0], checkMaxMM: c?.[1], holdMinYears: h?.[0], holdMaxYears: h?.[1], vintageMin: v?.[0], vintageMax: v?.[1] } });
    n++;
  }
  console.log(`rows scanned ${rows.length}, ranges filled ${n}`);
  await prisma.$disconnect();
})();
