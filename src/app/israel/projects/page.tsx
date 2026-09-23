import Link from "next/link";
import { ZoomBox } from "@/components/zoom-box";
import { prisma } from "@/lib/db";
import { PageHeader, Pager } from "@/components/ui";
import { str } from "@/lib/format";
import { yearOf, coDeveloperNames } from "@/lib/israel";
import { ProjectFiltersRail, type ProjectFilters } from "./filters";
import { CompanyLogo } from "@/components/company-logo";

export const metadata = { title: "Projects" };
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
 * Projects: whole buildings and developments, with the same filter rail as apartments and houses (city,
 * neighborhood, developer, units, stories, parking and delivery as ranges, pool, brochure, whether any units are
 * listed yet) and a sort. The apartments and houses inside each project hang off it.
 */
export default async function IlProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f: ProjectFilters = {
    q: str(sp.q).trim(),
    cities: list(sp.city),
    neighborhoods: list(sp.neighborhood),
    developers: list(sp.developer),
    unitsMin: num(sp.unitsMin),
    unitsMax: num(sp.unitsMax),
    storiesMin: num(sp.storiesMin),
    storiesMax: num(sp.storiesMax),
    parkingMin: num(sp.parkingMin),
    parkingMax: num(sp.parkingMax),
    yearMin: num(sp.yearMin),
    yearMax: num(sp.yearMax),
    pool: str(sp.pool),
    brochure: str(sp.brochure),
    listed: str(sp.listed),
    sort: str(sp.sort) || "updated",
  };
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const all = await prisma.ilProject.findMany({
    where: { pendingApproval: false }, // projects still in The Que are not in the list
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, street: true, city: true, neighborhood: true, totalUnits: true, parkingSpaces: true, stories: true, completionDate: true, pool: true, brochureName: true, updatedAt: true, developerId: true, developerIds: true, developer: { select: { id: true, name: true, domain: true, website: true } }, _count: { select: { apartments: true, houses: true } } },
  });
  const cities = [...new Set(all.map((p) => p.city).filter((c): c is string => Boolean(c)))].sort();
  const neighborhoods = [...new Set(all.map((p) => p.neighborhood).filter((c): c is string => Boolean(c)))].sort();
  const developers = [...new Set(all.map((p) => p.developer?.name).filter((c): c is string => Boolean(c)))].sort();

  const inRange = (v: number | null, lo: number | null, hi: number | null, top: number) => (lo == null && hi == null ? true : v == null ? false : v >= (lo ?? -Infinity) && (hi == null || hi >= top || v <= hi));
  const q = f.q.toLowerCase();
  const rows = all.filter((p) => {
    if (q && !`${p.name} ${p.street ?? ""} ${p.neighborhood ?? ""} ${p.city ?? ""} ${p.developer?.name ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.cities.length && !f.cities.includes(p.city ?? "")) return false;
    if (f.neighborhoods.length && !f.neighborhoods.includes(p.neighborhood ?? "")) return false;
    if (f.developers.length && !f.developers.includes(p.developer?.name ?? "")) return false;
    if (!inRange(p.totalUnits, f.unitsMin, f.unitsMax, 500)) return false;
    if (!inRange(p.stories, f.storiesMin, f.storiesMax, 50)) return false;
    if (!inRange(p.parkingSpaces, f.parkingMin, f.parkingMax, 600)) return false;
    if (!inRange(yearOf(p.completionDate), f.yearMin, f.yearMax, 2035)) return false;
    if (f.pool === "yes" && p.pool !== "Yes") return false;
    if (f.pool === "no" && p.pool !== "No") return false;
    if (f.brochure === "yes" && !p.brochureName) return false;
    if (f.brochure === "no" && p.brochureName) return false;
    const listed = p._count.apartments + p._count.houses;
    if (f.listed === "yes" && listed === 0) return false;
    if (f.listed === "no" && listed > 0) return false;
    return true;
  });
  const deliveryKey = (p: (typeof all)[number]) => {
    const m = p.completionDate?.match(/(\d{1,2})\s*\/\s*((?:19|20)\d{2})/);
    if (m) return Number(m[2]) * 100 + Number(m[1]);
    const y = yearOf(p.completionDate);
    return y ? y * 100 : null;
  };
  const by = (a: number | null, b: number | null, dir: 1 | -1) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a - b) * dir);
  rows.sort((a, b) => {
    switch (f.sort) {
      case "units-desc": return by(a.totalUnits, b.totalUnits, -1);
      case "units-asc": return by(a.totalUnits, b.totalUnits, 1);
      case "delivery-asc": return by(deliveryKey(a), deliveryKey(b), 1);
      case "delivery-desc": return by(deliveryKey(a), deliveryKey(b), -1);
      case "listed-desc": return b._count.apartments + b._count.houses - (a._count.apartments + a._count.houses);
      case "name": return a.name.localeCompare(b.name);
      default: return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
  });
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "page" && v) for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
    u.set("page", String(p));
    return `/israel/projects?${u}`;
  };
  const devNames = new Map((await prisma.ilCompany.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`${total.toLocaleString()} of ${all.length.toLocaleString()} projects`}
        actions={
          <Link href="/israel/projects/new" className="btn-primary">
            New project
          </Link>
        }
      />
      <div className="grid gap-4 px-8 py-4 xl:grid-cols-[300px_1fr]">
        <ProjectFiltersRail f={f} cities={cities} neighborhoods={neighborhoods} developers={developers} total={total} />
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3"><div id="zoom-tools" className="ml-auto" /></div>
          <div className="flex h-[calc(100vh-186px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
            <div className="min-h-0 flex-1 overflow-auto">
              <ZoomBox id="israel-projects"><table className="table dense w-full min-w-[1100px]">
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
                    <th>Pool</th>
                    <th>Brochure</th>
                    <th className="text-right">Units listed</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/israel/projects/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td>
                        {p.developer ? (
                          <Link href={`/israel/companies/${p.developer.id}`} className="inline-flex items-center gap-2 hover:underline">
                            <CompanyLogo domain={p.developer.domain ?? p.developer.website?.replace(/^https?:\/\//, "").split("/")[0]} name={p.developer.name} />
                            {p.developer.name}{coDeveloperNames(p, devNames).length ? ` + ${coDeveloperNames(p, devNames).join(", ")}` : ""}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>{p.street ?? <span className="text-muted">—</span>}</td>
                      <td>{p.city ?? <span className="text-muted">—</span>}</td>
                      <td>{p.neighborhood ?? <span className="text-muted">—</span>}</td>
                      <td className="text-right tabular-nums">{p.totalUnits ?? ""}</td>
                      <td className="text-right tabular-nums">{p.parkingSpaces ?? ""}</td>
                      <td className="text-right tabular-nums">{p.stories ?? ""}</td>
                      <td className="whitespace-nowrap">{p.completionDate ?? <span className="text-muted">—</span>}</td>
                      <td>{p.pool ?? <span className="text-muted">—</span>}</td>
                      <td>{p.brochureName ? "On file" : <span className="text-muted">—</span>}</td>
                      <td className="text-right tabular-nums">{p._count.apartments + p._count.houses}</td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-muted">
                        No projects match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></ZoomBox>
            </div>
          </div>
          <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
        </div>
      </div>
    </>
  );
}
