import Link from "next/link";
import { ZoomBox } from "@/components/zoom-box";
import { prisma } from "@/lib/db";
import { PageHeader, Pager } from "@/components/ui";
import { str } from "@/lib/format";
import { nis, parseJsonList, parseMirpasot, pricePerMeter, yearOf, coDeveloperNames } from "@/lib/israel";
import { ApartmentFilters, type AptFilters } from "./filters";
import { CompareCheck, CompareProvider } from "./compare-select";
import { CompanyLogo } from "@/components/company-logo";

export const metadata = { title: "Apartments" };
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
 * Apartments: the list, filtered by every field except asking price (city, neighborhood, sizes as ranges, rooms,
 * floor, built or delivery year, parking, seller type, direction, mamad, machsan) and sortable by price per meter.
 * Tickets still waiting for approval on the dashboard are not in this list.
 */
export default async function ApartmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f: AptFilters = {
    q: str(sp.q).trim(),
    cities: list(sp.city),
    neighborhoods: list(sp.neighborhood),
    sqmMin: num(sp.sqmMin),
    sqmMax: num(sp.sqmMax),
    mirpesetMin: num(sp.mirpesetMin),
    mirpesetMax: num(sp.mirpesetMax),
    roomsMin: num(sp.roomsMin),
    roomsMax: num(sp.roomsMax),
    floorMin: num(sp.floorMin),
    floorMax: num(sp.floorMax),
    yearMin: num(sp.yearMin),
    yearMax: num(sp.yearMax),
    parking: list(sp.parking),
    sellerTypes: list(sp.sellerType),
    directions: list(sp.direction),
    mamad: str(sp.mamad),
    machsan: str(sp.machsan),
    levels: list(sp.levels),
    mirpasot: list(sp.mirpasot),
    sukka: str(sp.sukka),
    ceilingMin: num(sp.ceilingMin),
    ceilingMax: num(sp.ceilingMax),
    sort: str(sp.sort) || "updated",
  };
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const compare = str(sp.compare) === "1";

  const all = await prisma.ilApartment.findMany({ where: { pendingApproval: false }, orderBy: { updatedAt: "desc" }, include: { developer: { select: { id: true, name: true, domain: true, website: true } }, project: { select: { name: true } } } });
  const cities = [...new Set(all.map((a) => a.city).filter((c): c is string => Boolean(c)))].sort();
  const neighborhoods = [...new Set(all.map((a) => a.neighborhood).filter((c): c is string => Boolean(c)))].sort();

  // open-ended tops: the last stop of each slider means "and up"
  const inRange = (v: number | null, lo: number | null, hi: number | null, top: number) => (lo == null && hi == null ? true : v == null ? false : v >= (lo ?? -Infinity) && (hi == null || hi >= top || v <= hi));
  const q = f.q.toLowerCase();
  const rows = all.filter((a) => {
    if (q && !`${a.name} ${a.street ?? ""} ${a.neighborhood ?? ""} ${a.city ?? ""} ${a.project?.name ?? ""} ${a.developer?.name ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.cities.length && !f.cities.includes(a.city ?? "")) return false;
    if (f.neighborhoods.length && !f.neighborhoods.includes(a.neighborhood ?? "")) return false;
    if (!inRange(a.internalSqm, f.sqmMin, f.sqmMax, 300)) return false;
    if (!inRange(a.mirpesetSqm ?? 0, f.mirpesetMin, f.mirpesetMax, 100)) return false;
    if (!inRange(a.rooms, f.roomsMin, f.roomsMax, 8)) return false;
    if (!inRange(a.floor, f.floorMin, f.floorMax, 40)) return false;
    if (!inRange(yearOf(a.completionDate), f.yearMin, f.yearMax, 2035)) return false;
    if (f.parking.length && !f.parking.includes(a.parkingSpots ?? "")) return false;
    if (f.sellerTypes.length && !f.sellerTypes.includes(a.sellerType ?? "")) return false;
    if (f.directions.length && !parseJsonList(a.direction).some((d) => f.directions.includes(d))) return false;
    if (f.mamad === "yes" && !a.mamad) return false;
    if (f.mamad === "no" && a.mamad) return false;
    if (f.machsan === "yes" && !(a.machsanSqm && a.machsanSqm > 0)) return false;
    if (f.machsan === "no" && a.machsanSqm && a.machsanSqm > 0) return false;
    if (f.levels.length && !f.levels.includes(String(a.levels && a.levels > 1 ? a.levels : 1))) return false;
    const mCount = parseMirpasot(a.mirpasot).length > 1 ? parseMirpasot(a.mirpasot).length : a.mirpesetCount ?? (a.mirpesetSqm ? 1 : 0);
    if (f.mirpasot.length && !f.mirpasot.includes(String(mCount))) return false;
    // the tallest ceiling on the ticket: the single height, or the highest level on a duplex
    const ceilings = [a.ceilingCm, ...parseJsonList(a.ceilingCms).map((x) => (x === "" ? null : Number(x)))].filter((x): x is number => x != null && !isNaN(x));
    if (!inRange(ceilings.length ? Math.max(...ceilings) : null, f.ceilingMin, f.ceilingMax, 400)) return false;
    const sk = (() => {
      const m = parseMirpasot(a.mirpasot);
      if (!m.length) return null;
      if (m.every((x) => x.sukka === "No")) return "no";
      if (m.some((x) => x.sukka === "Yes")) return "yes";
      if (m.some((x) => x.sukka === "Partial")) return "partial";
      return null;
    })();
    if (f.sukka === "yes" && sk !== "yes") return false;
    if (f.sukka === "partial" && sk !== "yes" && sk !== "partial") return false;
    if (f.sukka === "no" && sk !== "no") return false;
    return true;
  });
  const ppm = (a: (typeof all)[number]) => pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm);
  const by = <T,>(get: (a: (typeof all)[number]) => T | null, dir: 1 | -1) => (x: (typeof all)[number], y: (typeof all)[number]) => {
    const a = get(x), b = get(y);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a < b ? -dir : a > b ? dir : 0;
  };
  const sorters: Record<string, (x: (typeof all)[number], y: (typeof all)[number]) => number> = {
    "ppm-asc": by(ppm, 1),
    "ppm-desc": by(ppm, -1),
    "price-asc": by((a) => a.priceNis, 1),
    "price-desc": by((a) => a.priceNis, -1),
    "sqm-desc": by((a) => a.internalSqm, -1),
    "sqm-asc": by((a) => a.internalSqm, 1),
    "year-desc": by((a) => yearOf(a.completionDate), -1),
    "year-asc": by((a) => yearOf(a.completionDate), 1),
    name: by((a) => a.name.toLowerCase(), 1),
  };
  if (sorters[f.sort]) rows.sort(sorters[f.sort]);
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of list(v)) if (k !== "page") u.append(k, x);
    u.set("page", String(p));
    return `/israel/apartments?${u}`;
  };
  const devNames = new Map((await prisma.ilCompany.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader
        title="Apartments"
        subtitle={`${total.toLocaleString()} of ${all.length.toLocaleString()} apartments`}
        actions={
          <>
            <Link href={(() => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) for (const x of list(v)) if (k !== "compare") u.append(k, x); if (!compare) u.set("compare", "1"); const qs = u.toString(); return `/israel/apartments${qs ? `?${qs}` : ""}`; })()} className={compare ? "btn-secondary" : "btn-secondary"} title={compare ? "Leave compare mode" : "Tick up to five apartments and see them side by side"}>
              {compare ? "Done comparing" : "Compare units"}
            </Link>
            <Link href="/israel/apartments/new" className="btn-primary">
              New apartment
            </Link>
          </>
        }
      />
      <div className="grid gap-4 px-8 py-4 xl:grid-cols-[300px_1fr]">
        <ApartmentFilters f={f} cities={cities} neighborhoods={neighborhoods} total={total} />
        <div className="min-w-0">
          <Body compare={compare}>
          <div className="mb-2 flex items-center gap-3"><div id="zoom-tools" className="ml-auto" /></div>
          <div className="flex h-[calc(100vh-186px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
            <div className="min-h-0 flex-1 overflow-auto">
              <ZoomBox id="israel-apartments"><table className="table dense w-full min-w-[1200px]">
                <thead>
                  <tr>
                    {compare && <th className="w-8"></th>}
                    <th>Apartment</th>
                    <th>Degem</th>
                    <th>Developer</th>
                    <th>City</th>
                    <th className="text-right">Rooms</th>
                    <th className="text-right">Internal m²</th>
                    <th className="text-right">Mirpeset m²</th>
                    <th className="text-right">Floor</th>
                    <th>Parking</th>
                    <th>Seller</th>
                    <th className="text-right">Asking price</th>
                    <th className="text-right">₪ / m²</th>
                    <th>Built / delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.id}>
                      {compare && (
                        <td className="w-8">
                          <CompareCheck id={a.id} name={a.name} />
                        </td>
                      )}
                      <td className="max-w-[300px] whitespace-nowrap">
                        <Link href={`/israel/apartments/${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                        {a.street && !a.name.includes(a.street) && <span className="ml-2 text-xs text-muted">{a.street}</span>}
                      </td>
                      <td className="whitespace-nowrap text-xs">{a.degem ?? <span className="text-muted">—</span>}</td>
                      <td className="max-w-[220px]">
                        {a.developer ? (
                          <Link href={`/israel/companies/${a.developer.id}`} className="flex items-center gap-2 hover:underline">
                            <CompanyLogo domain={a.developer.domain ?? a.developer.website?.replace(/^https?:\/\//, "").split("/")[0]} name={a.developer.name} />
                            <span className="truncate">{a.developer.name}{coDeveloperNames(a, devNames).length ? ` + ${coDeveloperNames(a, devNames).join(", ")}` : ""}</span>
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{[a.neighborhood, a.city].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                      <td className="text-right tabular-nums">{a.rooms ?? ""}</td>
                      <td className="text-right tabular-nums">{a.internalSqm ?? ""}</td>
                      <td className="text-right tabular-nums">{a.mirpesetSqm ?? ""}</td>
                      <td className="text-right tabular-nums">{a.floor != null ? `${a.floor}${a.totalFloors ? ` / ${a.totalFloors}` : ""}` : ""}</td>
                      <td className="whitespace-nowrap">{a.parkingSpots ?? <span className="text-muted">—</span>}</td>
                      <td className="whitespace-nowrap text-xs">{a.sellerType ? a.sellerType.replace("Yad Rishona (developer)", "Yad rishona").replace("Second hand, ", "2nd hand, ") : <span className="text-muted">—</span>}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{nis(a.priceNis)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{nis(ppm(a))}</td>
                      <td className="whitespace-nowrap">{a.completionDate ?? <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={compare ? 14 : 13} className="py-10 text-center text-muted">
                        No apartments match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></ZoomBox>
            </div>
          </div>
          <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
          </Body>
        </div>
      </div>
    </>
  );
}

/** In compare mode the table sits inside the selection provider (tick boxes + the Compare bar); otherwise it renders as is. */
function Body({ compare, children }: { compare: boolean; children: React.ReactNode }) {
  return compare ? <CompareProvider>{children}</CompareProvider> : <>{children}</>;
}
