import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { MultiSelect } from "@/components/multi-select";
import { paneColumns, paneRows } from "./columns";
import { PropertyPanes } from "./panes";

export const metadata = { title: "Properties" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/**
 * Properties as a sheet in three panes (Sep 22, 2026): the property, its owner, its operator, one row per property
 * across all three. Up and down move together; each pane scrolls sideways on its own. Every cell edits in place,
 * and the Owner and Operator panes write to the contact card behind the row.
 */
export default async function AqPropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const stages = list(sp.stage);
  const cities = list(sp.city);
  const states = list(sp.state);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqPropertyWhereInput = {
    junkedAt: null, // junk properties live under Settings > Junk Properties (Shawn, Sep 23, 2026)
    AND: [
      q
        ? {
            OR: [
              { address: { contains: q, mode: "insensitive" } },
              { neighborhood: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { state: { contains: q, mode: "insensitive" } },
              { county: { contains: q, mode: "insensitive" } },
              { businessName: { contains: q, mode: "insensitive" } },
              { parcelId: { contains: q, mode: "insensitive" } },
              { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } },
              { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { operatorBrandName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } } } },
            ],
          }
        : {},
      stages.length ? { OR: stages.map((s) => ({ stages: { contains: `"${s}"` } })) } : {},
      cities.length ? { city: { in: cities } } : {},
      states.length ? { state: { in: states } } : {},
    ],
  };
  const [total, rows, allPlaces, dealStages, companies] = await Promise.all([
    prisma.aqProperty.count({ where }),
    prisma.aqProperty.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        companies: { include: { company: { select: { name: true } } } },
        contacts: { include: { contact: { include: { aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } } } } },
        aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
      },
    }),
    prisma.aqProperty.findMany({ where: { junkedAt: null }, select: { city: true, state: true } }),
    getAqDealStages(),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, domain: true, website: true } }),
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
        subtitle={`${total.toLocaleString()} properties · three panes: the property, its owner, its operator · click any cell to edit`}
        actions={
          <Link href="/acquisitions/properties/new" className="btn-primary">
            New property
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <SearchForm action="/acquisitions/properties" q={q} placeholder="Search address, business, county, parcel, company, person or brand">
          <div className="w-40">
            <MultiSelect name="stage" options={["Deal"]} selected={stages} placeholder="Deals and not" />
          </div>
          <div className="w-44">
            <MultiSelect name="city" options={cityOptions} selected={cities} placeholder="Any city" />
          </div>
          <div className="w-32">
            <MultiSelect name="state" options={stateOptions} selected={states} placeholder="Any state" />
          </div>
        </SearchForm>
        <div id="grid-tools" className="ml-auto" />
      </div>
      <div className="mx-6 h-[calc(100vh-150px)] min-h-[400px]">
        <PropertyPanes rows={paneRows(rows)} columns={paneColumns(dealStages, companies)} />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
