import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { IL_CITIES, nis, parseJsonList, pricePerMeter, sqm } from "@/lib/israel";
import { CompareCheck, CompareProvider } from "../apartments/compare-select";

export const metadata = { title: "Houses" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/**
 * Houses: the same list window as Apartments, for cottages and villas with a plot, floors and per-floor ceilings.
 * Compare mode (?compare=1) ticks up to five and opens them side by side. Tickets waiting for approval on the
 * dashboard are not in this list.
 */
export default async function HousesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const city = str(sp.city);
  const sort = str(sp.sort) || "updated";
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const compare = str(sp.compare) === "1";
  const where: Prisma.IlHouseWhereInput = {
    AND: [{ pendingApproval: false }, q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { street: { contains: q, mode: "insensitive" } }, { neighborhood: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { developer: { name: { contains: q, mode: "insensitive" } } }] } : {}, city ? { city } : {}],
  };
  const all = await prisma.ilHouse.findMany({ where, orderBy: { updatedAt: "desc" }, include: { developer: { select: { id: true, name: true } } } });
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
    "migrash-desc": by((h) => h.migrashSqm, -1),
    "sqm-desc": by((h) => h.internalSqm, -1),
  };
  if (sorters[sort]) all.sort(sorters[sort]);
  const total = all.length;
  const rows = all.slice((page - 1) * PAGE, page * PAGE);
  const cities = [...new Set([...IL_CITIES, ...all.map((h) => h.city).filter((c): c is string => Boolean(c))])].sort();
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
        subtitle={`${total.toLocaleString()} houses`}
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
      <div className="px-8 py-4">
        <SearchForm action="/israel/houses" q={q} placeholder="Search name, address, neighborhood, city or developer">
          {compare && <input type="hidden" name="compare" value="1" />}
          <select name="city" defaultValue={city} className="input w-40">
            <option value="">Any city</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} className="input w-48">
            <option value="updated">Recently updated</option>
            <option value="ppm-asc">₪ per m², low to high</option>
            <option value="ppm-desc">₪ per m², high to low</option>
            <option value="price-asc">Asking price, low to high</option>
            <option value="price-desc">Asking price, high to low</option>
            <option value="migrash-desc">Biggest migrash</option>
            <option value="sqm-desc">Biggest house</option>
          </select>
        </SearchForm>
      </div>
      <div className="mx-8">
        <Body compare={compare}>
          <div className="flex h-[calc(100vh-260px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
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
                  {rows.map((h) => (
                    <tr key={h.id}>
                      {compare && (
                        <td className="w-8">
                          <CompareCheck id={h.id} name={h.name} />
                        </td>
                      )}
                      <td>
                        <Link href={`/israel/houses/${h.id}`} className="font-medium hover:underline">
                          {h.name}
                        </Link>
                        {h.street && <div className="text-xs text-muted">{h.street}</div>}
                      </td>
                      <td>{h.developer ? <Link href={`/israel/companies/${h.developer.id}`} className="hover:underline">{h.developer.name}</Link> : <span className="text-muted">—</span>}</td>
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
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={compare ? 14 : 13} className="py-10 text-center text-muted">
                        No houses yet. New house adds the first ticket.
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
    </>
  );
}

function Body({ compare, children }: { compare: boolean; children: React.ReactNode }) {
  return compare ? <CompareProvider basePath="/israel/houses" noun="houses">{children}</CompareProvider> : <>{children}</>;
}
