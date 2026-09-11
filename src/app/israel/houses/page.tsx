import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Pager } from "@/components/ui";
import { str } from "@/lib/format";
import { nis, parseJsonList, parseMirpasot, pricePerMeter, sqm, yearOf } from "@/lib/israel";
import { CompareCheck, CompareProvider } from "../apartments/compare-select";
import { CompanyLogo } from "@/components/company-logo";
import { HouseFiltersPanel, type HouseFilters } from "./filters";

export const metadata = { title: "Houses" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const num = (v: string | string[] | undefined) => {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
};

/**
 * Houses: the list with the same filter rail as Apartments (city, neighborhood, sizes and migrash as ranges, rooms,
 * floors, built or delivery year, parking, seller type, mirpeset direction, mamad, sukka) and the same sorts.
 * Compare mode (?compare=1) ticks up to five. Tickets waiting for approval on the dashboard are not in this list.
 */
export default async function HousesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f: HouseFilters = {
    q: str(sp.q).trim(),
    cities: list(sp.city),
    neighborhoods: list(sp.neighborhood),
    sqmMin: num(sp.sqmMin),
    sqmMax: num(sp.sqmMax),
    mirpesetMin: num(sp.mirpesetMin),
    mirpesetMax: num(sp.mirpesetMax),
    migrashMin: num(sp.migrashMin),
    migrashMax: num(sp.migrashMax),
    roomsMin: num(sp.roomsMin),
    roomsMax: num(sp.roomsMax),
    floorsList: list(sp.floors),
    yearMin: num(sp.yearMin),
    yearMax: num(sp.yearMax),
    parking: list(sp.parking),
    sellerTypes: list(sp.sellerType),
    directions: list(sp.direction),
    mamad: str(sp.mamad),
    sukka: str(sp.sukka),
    mirpasot: list(sp.mirpasot),
    ceilingMin: num(sp.ceilingMin),
    ceilingMax: num(sp.ceilingMax),
    sort: str(sp.sort) || "updated",
  };
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const compare = str(sp.compare) === "1";

  const all = await prisma.ilHouse.findMany({ where: { pendingApproval: false }, orderBy: { updatedAt: "desc" }, include: { developer: { select: { id: true, name: true, domain: true, website: true } } } });
  const cities = [...new Set(all.map((h) => h.city).filter((c): c is string => Boolean(c)))].sort();
  const neighborhoods = [...new Set(all.map((h) => h.neighborhood).filter((c): c is string => Boolean(c)))].sort();

  // open-ended tops: the last stop of each slider means "and up"
  const inRange = (v: number | null, lo: number | null, hi: number | null, top: number) => (lo == null && hi == null ? true : v == null ? false : v >= (lo ?? -Infinity) && (hi == null || hi >= top || v <= hi));
  const sukkaOf = (h: (typeof all)[number]) => {
    const m = parseMirpasot(h.mirpasot);
    if (!m.length) return null;
    if (m.every((x) => x.sukka === "No")) return "no";
    if (m.some((x) => x.sukka === "Yes")) return "yes";
    if (m.some((x) => x.sukka === "Partial")) return "partial";
    return null;
  };
  const q = f.q.toLowerCase();
  const rows = all.filter((h) => {
    if (q && !`${h.name} ${h.street ?? ""} ${h.neighborhood ?? ""} ${h.city ?? ""} ${h.developer?.name ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.cities.length && !f.cities.includes(h.city ?? "")) return false;
    if (f.neighborhoods.length && !f.neighborhoods.includes(h.neighborhood ?? "")) return false;
    if (!inRange(h.internalSqm, f.sqmMin, f.sqmMax, 600)) return false;
    if (!inRange(h.mirpesetSqm ?? 0, f.mirpesetMin, f.mirpesetMax, 100)) return false;
    if (!inRange(h.migrashSqm, f.migrashMin, f.migrashMax, 2000)) return false;
    if (!inRange(h.rooms, f.roomsMin, f.roomsMax, 8)) return false;
    if (f.floorsList.length && !f.floorsList.includes(String(h.floors ?? ""))) return false;
    const mCount = parseMirpasot(h.mirpasot).length > 1 ? parseMirpasot(h.mirpasot).length : h.mirpesetCount ?? (h.mirpesetSqm ? 1 : 0);
    if (f.mirpasot.length && !f.mirpasot.includes(String(mCount))) return false;
    const ceilings = parseJsonList(h.ceilingCms).map((x) => Number(x)).filter((x) => x && !isNaN(x));
    if (!inRange(ceilings.length ? Math.max(...ceilings) : null, f.ceilingMin, f.ceilingMax, 400)) return false;
    if (!inRange(yearOf(h.completionDate), f.yearMin, f.yearMax, 2035)) return false;
    if (f.parking.length && !f.parking.includes(h.parkingSpots ?? "")) return false;
    if (f.sellerTypes.length && !f.sellerTypes.includes(h.sellerType ?? "")) return false;
    if (f.directions.length && !parseJsonList(h.mirpesetDirection).some((d) => f.directions.includes(d))) return false;
    if (f.mamad === "yes" && !h.mamad) return false;
    if (f.mamad === "no" && h.mamad) return false;
    const sk = sukkaOf(h);
    if (f.sukka === "yes" && sk !== "yes") return false;
    if (f.sukka === "partial" && sk !== "yes" && sk !== "partial") return false;
    if (f.sukka === "no" && sk !== "no") return false;
    return true;
  });
  const ppm = (h: (typeof all)[number]) => pricePerMeter(h.priceNis, h.internalSqm, h.mirpesetSqm);
  const by = <T,>(get: (h: (typeof all)[number]) => T | null, dir: 1 | -1) => (x: (typeof all)[number], y: (typeof all)[number]) => {
    const a = get(x), b = get(y);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a < b ? -dir : a > b ? dir : 0;
  };
  const sorters: Record<string, (x: (typeof all)[number], y: (typeof all)[number]) => number> = {
    "ppm-asc": by(ppm, 1),
    "ppm-desc": by(ppm, -1),
    "price-asc": by((h) => h.priceNis, 1),
    "price-desc": by((h) => h.priceNis, -1),
    "sqm-desc": by((h) => h.internalSqm, -1),
    "sqm-asc": by((h) => h.internalSqm, 1),
    "migrash-desc": by((h) => h.migrashSqm, -1),
    "year-desc": by((h) => yearOf(h.completionDate), -1),
    "year-asc": by((h) => yearOf(h.completionDate), 1),
    name: by((h) => h.name.toLowerCase(), 1),
  };
  if (sorters[f.sort]) rows.sort(sorters[f.sort]);
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const withParams = (edit: (u: URLSearchParams) => void) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of list(v)) u.append(k, x);
    edit(u);
    const qs = u.toString();
    return `/israel/houses${qs ? `?${qs}` : ""}`;
  };
  const makeHref = (p: number) => withParams((u) => u.set("page", String(p)));
  return (
    <>
      <PageHeader
        title="Houses"
        subtitle={`${total.toLocaleString()} of ${all.length.toLocaleString()} houses`}
        actions={
          <>
            <Link href={withParams((u) => (compare ? u.delete("compare") : u.set("compare", "1")))} className="btn-secondary" title={compare ? "Leave compare mode" : "Tick up to five houses and see them side by side"}>
              {compare ? "Done comparing" : "Compare houses"}
            </Link>
            <Link href="/israel/houses/new" className="btn-primary">
              New house
            </Link>
          </>
        }
      />
      <div className="grid gap-4 px-8 py-4 xl:grid-cols-[300px_1fr]">
        <HouseFiltersPanel f={f} cities={cities} neighborhoods={neighborhoods} total={total} compare={compare} />
        <div className="min-w-0">
          <Body compare={compare}>
            <div className="flex h-[calc(100vh-220px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="table dense w-full min-w-[1200px]">
                  <thead>
                    <tr>
                      {compare && <th className="w-8"></th>}
                      <th>House</th>
                      <th>Developer</th>
                      <th>City</th>
                      <th className="text-right">Rooms</th>
                      <th className="text-right">Floors</th>
                      <th className="text-right">Internal m²</th>
                      <th className="text-right">Mirpeset m²</th>
                      <th className="text-right">Migrash</th>
                      <th>Parking</th>
                      <th>Seller</th>
                      <th className="text-right">Asking price</th>
                      <th className="text-right">₪ / m²</th>
                      <th>Built / delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((h) => (
                      <tr key={h.id}>
                        {compare && (
                          <td className="w-8">
                            <CompareCheck id={h.id} name={h.name} />
                          </td>
                        )}
                        <td className="max-w-[300px] whitespace-nowrap">
                          <Link href={`/israel/houses/${h.id}`} className="font-medium hover:underline">
                            {h.name}
                          </Link>
                          {h.street && !h.name.includes(h.street) && <span className="ml-2 text-xs text-muted">{h.street}</span>}
                        </td>
                        <td className="max-w-[220px]">
                          {h.developer ? (
                            <Link href={`/israel/companies/${h.developer.id}`} className="flex items-center gap-2 hover:underline">
                              <CompanyLogo domain={h.developer.domain ?? h.developer.website?.replace(/^https?:\/\//, "").split("/")[0]} name={h.developer.name} />
                              <span className="truncate">{h.developer.name}</span>
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap">{[h.neighborhood, h.city].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                        <td className="text-right tabular-nums">{h.rooms ?? ""}</td>
                        <td className="text-right tabular-nums" title={parseJsonList(h.ceilingCms).filter(Boolean).length ? `Ceilings: ${parseJsonList(h.ceilingCms).filter(Boolean).join(", ")} cm` : undefined}>
                          {h.floors ?? ""}
                        </td>
                        <td className="text-right tabular-nums">{h.internalSqm ?? ""}</td>
                        <td className="text-right tabular-nums" title={h.mirpesetCount && h.mirpesetCount > 1 ? `${h.mirpesetCount} mirpasot` : undefined}>
                          {h.mirpesetSqm ?? ""}
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums" title={h.migrashSqm ? `${(h.migrashSqm / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} dunam` : undefined}>
                          {h.migrashSqm ? sqm(h.migrashSqm) : ""}
                        </td>
                        <td className="whitespace-nowrap">{h.parkingSpots ?? <span className="text-muted">—</span>}</td>
                        <td className="whitespace-nowrap text-xs">{h.sellerType ? h.sellerType.replace("Yad Rishona (developer)", "Yad rishona").replace("Second hand, ", "2nd hand, ") : <span className="text-muted">—</span>}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{nis(h.priceNis)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{nis(ppm(h))}</td>
                        <td className="whitespace-nowrap">{h.completionDate ?? <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                    {pageRows.length === 0 && (
                      <tr>
                        <td colSpan={compare ? 14 : 13} className="py-10 text-center text-muted">
                          {all.length === 0 ? "No houses yet. New house adds the first ticket." : "No houses match these filters."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
          </Body>
        </div>
      </div>
    </>
  );
}

function Body({ compare, children }: { compare: boolean; children: React.ReactNode }) {
  return compare ? <CompareProvider basePath="/israel/houses" noun="houses">{children}</CompareProvider> : <>{children}</>;
}
