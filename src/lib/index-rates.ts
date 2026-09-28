import { prisma } from "@/lib/db";
import { RATE_INDEXES, setIndexTable, type IndexTable, type RateIndex } from "@/lib/rates";

/**
 * The day's SOFR, Prime and treasury yields, from FRED (public CSV, no key), kept in IndexRate rows and refreshed
 * once a day by the cron. Every server render calls `ensureIndexRates` first so the pure helpers in rates.ts can
 * price a floating loan; the deal form gets the table as a prop.
 */
const FRED: Record<RateIndex, string> = { SOFR: "SOFR", Prime: "DPRIME", "2 Year Treasury": "DGS2", "5 Year Treasury": "DGS5", "7 Year Treasury": "DGS7", "10 Year Treasury": "DGS10" };

let cached: { table: IndexTable; at: number } | null = null;

/** Pull the latest reading of every index from FRED and store it. Returns how many indices were updated. */
export async function refreshIndexRates(): Promise<number> {
  let n = 0;
  for (const index of RATE_INDEXES) {
    try {
      const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${FRED[index]}`, { cache: "no-store" });
      if (!res.ok) continue;
      const lines = (await res.text()).trim().split(/\r?\n/).slice(1).filter((l) => !/,\.?$/.test(l));
      const last = lines[lines.length - 1]?.split(",");
      const value = last ? Number(last[1]) : NaN;
      if (!last || !Number.isFinite(value)) continue;
      await prisma.indexRate.upsert({ where: { index }, create: { index, value, asOf: new Date(last[0]) }, update: { value, asOf: new Date(last[0]) } });
      n++;
    } catch (e) {
      console.error("index rate refresh failed", index, String(e).slice(0, 120));
    }
  }
  cached = null;
  return n;
}

/** The table from the database (refreshed when empty or older than a day), also handed to rates.ts for this process. */
export async function ensureIndexRates(): Promise<IndexTable> {
  if (cached && Date.now() - cached.at < 10 * 60_000) {
    setIndexTable(cached.table);
    return cached.table;
  }
  let rows = await prisma.indexRate.findMany();
  const stale = !rows.length || rows.some((r) => Date.now() - r.updatedAt.getTime() > 26 * 3_600_000);
  if (stale) {
    await refreshIndexRates().catch(() => 0);
    rows = await prisma.indexRate.findMany();
  }
  const table: IndexTable = Object.fromEntries(rows.map((r) => [r.index, { value: r.value, asOf: r.asOf.toISOString().slice(0, 10) }]));
  cached = { table, at: Date.now() };
  setIndexTable(table);
  return table;
}

/** For the cron: a refresh once a day. */
export async function refreshIndexRatesIfStale(): Promise<number> {
  const newest = await prisma.indexRate.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  if (newest && Date.now() - newest.updatedAt.getTime() < 20 * 3_600_000) return 0;
  return refreshIndexRates();
}
