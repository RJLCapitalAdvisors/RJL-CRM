import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { IL_CITIES } from "@/lib/israel";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";
const PAGE = 50;

/** Projects: whole buildings and developments. The apartments inside each hang off it. */
export default async function IlProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const city = str(sp.city);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.IlProjectWhereInput = {
    AND: [q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { street: { contains: q, mode: "insensitive" } }, { neighborhood: { contains: q, mode: "insensitive" } }, { developer: { name: { contains: q, mode: "insensitive" } } }] } : {}, city ? { city } : {}],
  };
  const [total, rows] = await Promise.all([
    prisma.ilProject.count({ where }),
    prisma.ilProject.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { developer: { select: { id: true, name: true } }, _count: { select: { apartments: true } } } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (city) u.set("city", city);
    u.set("page", String(p));
    return `/israel/projects?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`${total.toLocaleString()} projects`}
        actions={
          <Link href="/israel/projects/new" className="btn-primary">
            New project
          </Link>
        }
      />
      <div className="px-8 py-4">
        <SearchForm action="/israel/projects" q={q} placeholder="Search name, address, neighborhood, or developer">
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
          <table className="table dense w-full min-w-[1000px]">
            <thead>
              <tr>
                <th>Project</th>
                <th>Developer</th>
                <th>Address</th>
                <th>City</th>
                <th>Neighborhood</th>
                <th className="text-right">Units</th>
                <th className="text-right">Parking</th>
                <th className="text-right">Stories</th>
                <th>Built / delivery</th>
                <th className="text-right">Apartments listed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/israel/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.developer ? <Link href={`/israel/companies/${p.developer.id}`} className="hover:underline">{p.developer.name}</Link> : <span className="text-muted">—</span>}</td>
                  <td>{p.street ?? <span className="text-muted">—</span>}</td>
                  <td>{p.city ?? <span className="text-muted">—</span>}</td>
                  <td>{p.neighborhood ?? <span className="text-muted">—</span>}</td>
                  <td className="text-right tabular-nums">{p.totalUnits ?? ""}</td>
                  <td className="text-right tabular-nums">{p.parkingSpaces ?? ""}</td>
                  <td className="text-right tabular-nums">{p.stories ?? ""}</td>
                  <td className="whitespace-nowrap">{p.completionDate ?? <span className="text-muted">—</span>}</td>
                  <td className="text-right tabular-nums">{p._count.apartments}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-muted">
                    No projects match.
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
