import { prisma } from "@/lib/db";
import { PageHeader, Pager } from "@/components/ui";
import { ZoomBox } from "@/components/zoom-box";
import { RentCell } from "./rent-cell";
import { RentsFilters } from "./rents-filters";

export const metadata = { title: "The Rents" };
export const dynamic = "force-dynamic";

const PAGE = 300;

/**
 * The Rents (Jonathan, Oct 5, 2026): asking rents by neighborhood and room count, one row per neighborhood and room
 * count (1 to 6), the rent typed straight into the first column. Every apartment ticket reads its expected rent and
 * yield from here, and the Map View's yield heat map is built on it. Laid out like the apartments list: the filter
 * card on the left, the table on the right. Neighborhoods came from Wikidata and OpenStreetMap, filed under the
 * nearest city or town.
 */
export default async function RentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const city = s("city"), q = s("q"), rooms = Number(s("rooms")) || 0, filled = s("filled") === "1";
  const page = Math.max(1, Number(s("page")) || 1);
  const where = {
    ...(rooms ? { rooms } : {}),
    ...(filled ? { rentNis: { not: null } } : {}),
    neighborhood: { ...(city ? { city } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { nameHe: { contains: q } }, { city: { contains: q, mode: "insensitive" as const } }] } : {}) },
  };
  const [total, rows, cities, typed] = await Promise.all([
    prisma.ilRent.count({ where }),
    prisma.ilRent.findMany({ where, include: { neighborhood: { select: { name: true, nameHe: true, city: true } } }, orderBy: [{ neighborhood: { city: "asc" } }, { neighborhood: { name: "asc" } }, { rooms: "asc" }], skip: (page - 1) * PAGE, take: PAGE }),
    prisma.ilNeighborhood.groupBy({ by: ["city"], _count: true, orderBy: { city: "asc" } }),
    prisma.ilRent.count({ where: { rentNis: { not: null } } }),
  ]);
  const hoods = cities.reduce((n, c) => n + c._count, 0);
  const makeHref = (p: number) => `/israel/rents?${new URLSearchParams({ ...(city ? { city } : {}), ...(q ? { q } : {}), ...(rooms ? { rooms: String(rooms) } : {}), ...(filled ? { filled: "1" } : {}), page: String(p) }).toString()}`;
  return (
    <>
      <PageHeader title="The Rents" subtitle={`${hoods.toLocaleString("en-US")} neighborhoods in ${cities.length} cities and towns · ${typed.toLocaleString("en-US")} rents typed · click a rent to type it; apartment tickets and the yield heat map read from here`} />
      <div className="grid gap-4 px-8 py-4 xl:grid-cols-[300px_1fr]">
        <RentsFilters cities={cities.map((c) => ({ city: c.city, n: c._count }))} initial={{ city, q, rooms, filled }} total={total} typed={typed} />
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
            <div id="zoom-tools" className="ml-auto" />
          </div>
          <div className="flex h-[calc(100vh-124px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
            <div className="min-h-0 flex-1 overflow-auto">
              <ZoomBox id="il-rents">
                <table className="table dense w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-40 text-right">Rent (₪ a month)</th>
                      <th className="w-20 text-right">Rooms</th>
                      <th>Neighborhood</th>
                      <th>City</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="text-right">
                          <RentCell rentId={r.id} value={r.rentNis} />
                        </td>
                        <td className="text-right tabular-nums">{r.rooms}</td>
                        <td>
                          {r.neighborhood.name}
                          {r.neighborhood.nameHe && r.neighborhood.nameHe !== r.neighborhood.name ? <span className="ml-2 text-xs text-muted" dir="rtl">{r.neighborhood.nameHe}</span> : null}
                        </td>
                        <td>{r.neighborhood.city}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-muted">
                          No neighborhoods match. Clear the filters, or widen the search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ZoomBox>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
