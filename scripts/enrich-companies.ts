/**
 * Backfill company records from their websites.
 *   npm run enrich            -> companies that matter first (on a progress report, or tagged with a role), never enriched
 *   npm run enrich -- --all   -> every company with a domain, never enriched
 *   npm run enrich -- --limit 200
 * Also sets website = https://domain for every company that has a domain but no website (instant, no fetch).
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { enrichCompany } from "../src/lib/enrich";

const args = process.argv.slice(2);
const all = args.includes("--all");
const limit = Number(args[args.indexOf("--limit") + 1]) || 400;
const CONCURRENCY = 4;

async function main() {
  const quick = await prisma.company.findMany({ where: { domain: { not: null }, OR: [{ website: null }, { website: "" }] }, select: { id: true, domain: true } });
  for (const c of quick) await prisma.company.update({ where: { id: c.id }, data: { website: `https://${c.domain}` } });
  console.log(`website filled from domain: ${quick.length}`);

  const where = all
    ? { domain: { not: null }, enrichedAt: null }
    : { domain: { not: null }, enrichedAt: null, OR: [{ NOT: { roles: "[]" } }, { contacts: { some: { dealRows: { some: {} } } } }, { deals: { some: {} } }] };
  const targets = await prisma.company.findMany({ where, select: { id: true, name: true, domain: true }, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }], take: limit });
  console.log(`enriching ${targets.length} companies (${CONCURRENCY} at a time)…`);
  let done = 0, ok = 0;
  const stats: Record<string, number> = {};
  const q = [...targets];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let c = q.shift(); c; c = q.shift()) {
        const r = await enrichCompany(c.id).catch((e) => ({ ok: false, reason: String(e), filled: [] as string[] }));
        done++;
        if (r.ok) ok++;
        for (const f of r.filled) stats[f] = (stats[f] ?? 0) + 1;
        if (done % 25 === 0) console.log(`${done}/${targets.length} · ok ${ok} · ${JSON.stringify(stats)}`);
      }
    }),
  );
  console.log(`done ${done}, reachable ${ok}, fields filled:`, stats);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
