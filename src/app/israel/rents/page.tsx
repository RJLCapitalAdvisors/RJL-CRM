import { prisma } from "@/lib/db";
import { PageHeader, Pager } from "@/components/ui";
import { ZoomBox } from "@/components/zoom-box";
import { RentsGrid } from "./rents-grid";
import { RentsFilters } from "./rents-filters";

export const metadata = { title: "The Rents" };
export const dynamic = "force-dynamic";

const PAGE = 400;

/**
 * The Rents (Jonathan, Oct 5, 2026): asking rents by neighborhood and room count, one row per neighborhood and room
 * count (1 to 8), the rent typed straight into the first column. Every apartment ticket reads its expected rent and
 * yield from here, and the Map View's yield heat map is built on it. Neighborhoods came from OpenStreetMap with the
 * nearest city or town as their city.
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
  const grid = rows.map((r) => ({ id: r.id, rentNis: r.rentNis == null ? "" : String(r.rentNis), rooms: String(r.rooms), neighborhood: r.neighborhood.nameHe && r.neighborhood.nameHe !== r.neighborhood.name ? `${r.neighborhood.name} (${r.neighborhood.nameHe})` : r.neighborhood.name, city: r.neighborhood.city }));
  const hoods = cities.reduce((n, c) => n + c._count, 0);
  return (
    <>
      <PageHeader title="The Rents" subtitle={`${hoods.toLocaleString("en-US")} neighborhoods in ${cities.length} cities and towns · ${typed.toLocaleString("en-US")} rents typed so far · type a rent and it saves; every apartment ticket and the yield heat map read from here`} />
      <div className="flex h-[calc(100vh-44px)] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-6 py-2">
          <RentsFilters cities={cities.map((c) => ({ city: c.city, n: c._count }))} initial={{ city, q, rooms, filled }} />
          <div id="zoom-tools" className="ml-auto" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ZoomBox id="il-rents">
            <RentsGrid rows={grid} />
          </ZoomBox>
        </div>
        <div className="border-t border-line bg-paper px-6 py-1.5">
          <Pager page={page} pageSize={PAGE} total={total} makeHref={(p) => `/israel/rents?${new URLSearchParams({ ...(city ? { city } : {}), ...(q ? { q } : {}), ...(rooms ? { rooms: String(rooms) } : {}), ...(filled ? { filled: "1" } : {}), page: String(p) }).toString()}`} />
        </div>
      </div>
    </>
  );
}
