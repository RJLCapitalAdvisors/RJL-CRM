import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";
import { AQ_STAGES, aqFullName, aqStageTone, parseJsonList, usd } from "@/lib/acquisitions";
import { IlRoleCell } from "@/components/il-role-cell";
import { MultiSelect } from "@/components/multi-select";
import { setAqPropertyStages } from "../actions";

export const metadata = { title: "Properties" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/** Properties: every address in play, its stage tokens, the companies and people around it. Address, neighborhood, city and state are separate so each can be searched and filtered. */
export default async function AqPropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const stages = list(sp.stage);
  const cities = list(sp.city);
  const states = list(sp.state);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqPropertyWhereInput = {
    AND: [
      q ? { OR: [{ address: { contains: q, mode: "insensitive" } }, { neighborhood: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { state: { contains: q, mode: "insensitive" } }, { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } }, { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } } }] } : {},
      stages.length ? { OR: stages.map((s) => ({ stages: { contains: `"${s}"` } })) } : {},
      cities.length ? { city: { in: cities } } : {},
      states.length ? { state: { in: states } } : {},
    ],
  };
  const [total, rows, allPlaces] = await Promise.all([
    prisma.aqProperty.count({ where }),
    prisma.aqProperty.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { companies: { include: { company: { select: { id: true, name: true } } } }, contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } } } }),
    prisma.aqProperty.findMany({ select: { city: true, state: true } }),
  ]);
  const cityOptions = [...new Set(allPlaces.map((p) => p.city).filter((c): c is string => Boolean(c)))].sort();
  const stateOptions = [...new Set(allPlaces.map((p) => p.state).filter((c): c is string => Boolean(c)))].sort();
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const s of stages) u.append("stage", s);
    for (const c of cities) u.append("city", c);
    for (const s of states) u.append("state", s);
    u.set("page", String(p));
    return `/acquisitions/properties?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Properties"
        subtitle={`${total.toLocaleString()} properties`}
        actions={
          <Link href="/acquisitions/properties/new" className="btn-primary">
            New property
          </Link>
        }
      />
      <div className="px-8 py-4">
        <SearchForm action="/acquisitions/properties" q={q} placeholder="Search address, neighborhood, city, company, or person">
          <div className="w-48">
            <MultiSelect name="stage" options={AQ_STAGES} selected={stages} placeholder="Any stage" />
          </div>
          <div className="w-44">
            <MultiSelect name="city" options={cityOptions} selected={cities} placeholder="Any city" />
          </div>
          <div className="w-32">
            <MultiSelect name="state" options={stateOptions} selected={states} placeholder="Any state" />
          </div>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-260px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full min-w-[1100px]">
            <thead>
              <tr>
                <th>Address</th>
                <th>Neighborhood</th>
                <th>City</th>
                <th>State</th>
                <th>Stage</th>
                <th>Companies</th>
                <th>Contacts</th>
                <th className="text-right">Asking</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/acquisitions/properties/${p.id}`} className="font-medium hover:underline">
                      {p.address}
                    </Link>
                    {parseJsonList(p.stages).includes("Call me back") && p.callBackAt && <div className="text-[11px] text-muted">call back {fmtDate(p.callBackAt)}</div>}
                  </td>
                  <td>{p.neighborhood ?? <span className="text-muted">—</span>}</td>
                  <td>{p.city ?? <span className="text-muted">—</span>}</td>
                  <td>{p.state ?? <span className="text-muted">—</span>}</td>
                  <td>
                    <IlRoleCell roles={p.stages} options={AQ_STAGES} action={setAqPropertyStages.bind(null, p.id)} />
                    {parseJsonList(p.stages).includes("Deal") && p.dealStage && <span className={`chip mt-1 text-[10px] ${aqStageTone("Deal")}`}>{p.dealStage}</span>}
                  </td>
                  <td className="max-w-[220px] truncate">
                    {p.companies.length ? p.companies.map((x, i) => (
                      <span key={x.company.id}>
                        {i > 0 && ", "}
                        <Link href={`/acquisitions/companies/${x.company.id}`} className="hover:underline">
                          {x.company.name}
                        </Link>
                      </span>
                    )) : <span className="text-muted">—</span>}
                  </td>
                  <td className="max-w-[220px] truncate">
                    {p.contacts.length ? p.contacts.map((x, i) => (
                      <span key={x.contact.id}>
                        {i > 0 && ", "}
                        <Link href={`/acquisitions/contacts/${x.contact.id}`} className="hover:underline">
                          {aqFullName(x.contact)}
                        </Link>
                      </span>
                    )) : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-right tabular-nums">{p.askingPrice != null ? usd(p.askingPrice) : ""}</td>
                  <td className="whitespace-nowrap text-muted">{fmtDate(p.updatedAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-muted">
                    No properties match.
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
