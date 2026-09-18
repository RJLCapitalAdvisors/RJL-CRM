import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";
import { AQ_STAGES, aqStageTone, parseJsonList } from "@/lib/acquisitions";
import { IlRoleCell } from "@/components/il-role-cell";
import { MultiSelect } from "@/components/multi-select";
import { setAqPropertyStages } from "../actions";

export const metadata = { title: "Properties" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/** Properties: every address in play, who owns it and how to reach them, the last call result and the follow-up. City and state are separate so each can be filtered. */
export default async function AqPropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const stages = list(sp.stage);
  const cities = list(sp.city);
  const states = list(sp.state);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqPropertyWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { address: { contains: q, mode: "insensitive" } },
              { neighborhood: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { state: { contains: q, mode: "insensitive" } },
              { businessName: { contains: q, mode: "insensitive" } },
              { ownerEntity: { contains: q, mode: "insensitive" } },
              { ownerName: { contains: q, mode: "insensitive" } },
              { parcelId: { contains: q, mode: "insensitive" } },
              { primaryPhone: { contains: q } },
              { secondaryPhone: { contains: q } },
              { otherPhones: { contains: q } },
              { primaryEmail: { contains: q, mode: "insensitive" } },
              { emails: { contains: q, mode: "insensitive" } },
              { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } },
              { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } } },
            ],
          }
        : {},
      stages.length ? { OR: stages.map((s) => ({ stages: { contains: `"${s}"` } })) } : {},
      cities.length ? { city: { in: cities } } : {},
      states.length ? { state: { in: states } } : {},
    ],
  };
  const [total, rows, allPlaces] = await Promise.all([
    prisma.aqProperty.count({ where }),
    prisma.aqProperty.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
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
        <SearchForm action="/acquisitions/properties" q={q} placeholder="Search address, business, owner, phone, email, parcel, company or person">
          <div className="w-48">
            <MultiSelect name="stage" options={AQ_STAGES} selected={stages} placeholder="Any call result" />
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
          <table className="table dense w-full min-w-[1200px]">
            <thead>
              <tr>
                <th>Address</th>
                <th>City</th>
                <th>State</th>
                <th>Business</th>
                <th>Owner</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Call result</th>
                <th>Last call</th>
                <th>Follow up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const followUp = p.followUpAt ?? p.callBackAt;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/acquisitions/properties/${p.id}`} className="font-medium hover:underline">
                        {p.address}
                      </Link>
                      {p.neighborhood && <div className="text-[11px] text-muted">{p.neighborhood}</div>}
                    </td>
                    <td>{p.city ?? <span className="text-muted">—</span>}</td>
                    <td>{p.state ?? <span className="text-muted">—</span>}</td>
                    <td className="max-w-[180px] truncate">{p.businessName ?? <span className="text-muted">—</span>}</td>
                    <td className="max-w-[200px]">
                      <div className="truncate">{p.ownerName ?? p.ownerEntity ?? <span className="text-muted">—</span>}</div>
                      {p.ownerName && p.ownerEntity && <div className="truncate text-[11px] text-muted">{p.ownerEntity}</div>}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{p.primaryPhone ?? <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap">{p.assetType ?? <span className="text-muted">—</span>}</td>
                    <td>
                      <IlRoleCell roles={p.stages} options={AQ_STAGES} action={setAqPropertyStages.bind(null, p.id)} />
                      {parseJsonList(p.stages).includes("Deal") && p.dealStage && <span className={`chip mt-1 text-[10px] ${aqStageTone("Deal")}`}>{p.dealStage}</span>}
                    </td>
                    <td className="whitespace-nowrap text-muted">{p.lastCallDate ? fmtDate(p.lastCallDate) : "—"}</td>
                    <td className="whitespace-nowrap">{followUp ? <span className={followUp.getTime() < Date.now() && !p.callBackDismissedAt ? "text-amber-800" : ""}>{fmtDate(followUp)}</span> : <span className="text-muted">—</span>}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-muted">
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
