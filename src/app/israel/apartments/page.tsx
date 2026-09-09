import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { IL_CITIES, nis, pricePerMeter } from "@/lib/israel";

export const metadata = { title: "Apartments" };
export const dynamic = "force-dynamic";
const PAGE = 50;

/** Apartments: the list, in the same window as the RJL Capital Advisors company list. Click a row to open the ticket. */
export default async function ApartmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const city = str(sp.city);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.IlApartmentWhereInput = {
    AND: [
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { street: { contains: q, mode: "insensitive" } }, { neighborhood: { contains: q, mode: "insensitive" } }, { developer: { name: { contains: q, mode: "insensitive" } } }] } : {},
      city ? { city } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.ilApartment.count({ where }),
    prisma.ilApartment.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { developer: { select: { id: true, name: true } } } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (city) u.set("city", city);
    u.set("page", String(p));
    return `/israel/apartments?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Apartments"
        subtitle={`${total.toLocaleString()} apartments`}
        actions={
          <Link href="/israel/apartments/new" className="btn-primary">
            New apartment
          </Link>
        }
      />
      <div className="px-8 py-4">
        <SearchForm action="/israel/apartments" q={q} placeholder="Search name, address, neighborhood, or developer">
          <select name="city" defaultValue={city} className="input w-44">
            <option value="">Any city</option>
            {IL_CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-260px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full min-w-[1100px]">
            <thead>
              <tr>
                <th>Apartment</th>
                <th>Developer</th>
                <th>City</th>
                <th className="text-right">Rooms</th>
                <th className="text-right">Internal m²</th>
                <th className="text-right">Mirpeset m²</th>
                <th className="text-right">Floor</th>
                <th>Parking</th>
                <th className="text-right">Asking price</th>
                <th className="text-right">₪ / m²</th>
                <th>Built / delivery</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/israel/apartments/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    {a.street && <div className="text-xs text-muted">{a.street}</div>}
                  </td>
                  <td>{a.developer ? <Link href={`/israel/companies/${a.developer.id}`} className="hover:underline">{a.developer.name}</Link> : <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap">{[a.neighborhood, a.city].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                  <td className="text-right tabular-nums">{a.rooms ?? ""}</td>
                  <td className="text-right tabular-nums">{a.internalSqm ?? ""}</td>
                  <td className="text-right tabular-nums">{a.mirpesetSqm ?? ""}</td>
                  <td className="text-right tabular-nums">{a.floor != null ? `${a.floor}${a.totalFloors ? ` / ${a.totalFloors}` : ""}` : ""}</td>
                  <td className="whitespace-nowrap">{a.parkingSpots ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{nis(a.priceNis)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))}</td>
                  <td className="whitespace-nowrap">{a.completionDate ?? <span className="text-muted">—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-muted">
                    No apartments match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
