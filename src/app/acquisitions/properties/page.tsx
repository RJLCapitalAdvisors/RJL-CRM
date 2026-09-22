import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ASSET_TYPES, aqFullName, parseJsonList } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { US_STATES } from "@/lib/taxonomy";
import { MultiSelect } from "@/components/multi-select";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { AqGrid } from "../grid";

export const metadata = { title: "Properties" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Properties as a sheet: every field the ticket has, in columns you can drag into your own order and widen, scrolling
 * sideways, every cell editable in place (Jonathan, Sep 18, 2026). Search and the filters narrow the rows.
 */
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
              { county: { contains: q, mode: "insensitive" } },
              { parcelId: { contains: q, mode: "insensitive" } },
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
  const [total, rows, allPlaces, dealStages] = await Promise.all([
    prisma.aqProperty.count({ where }),
    prisma.aqProperty.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { companies: { include: { company: { select: { name: true } } } }, contacts: { include: { contact: { select: { firstName: true, lastName: true, email: true, roles: true } } } }, aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } },
    }),
    prisma.aqProperty.findMany({ select: { city: true, state: true } }),
    getAqDealStages(),
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
  const columns: GridColumn[] = [
    { key: "address", label: "Property Address", type: "text", width: 220 },
    { key: "city", label: "City", type: "text", width: 130 },
    { key: "state", label: "State", type: "select", options: Object.keys(US_STATES), width: 80 },
    { key: "county", label: "County", type: "text", width: 120 },
    { key: "businessName", label: "Current Business", type: "text", width: 180 },
    { key: "assetType", label: "Asset Type", type: "select", options: AQ_ASSET_TYPES, width: 130 },
    { key: "parcelId", label: "Parcel ID", type: "text", width: 130 },
    { key: "owners", label: "Owners", type: "readonly", width: 200 },
    { key: "operators", label: "Operators", type: "readonly", width: 200 },
    { key: "acreage", label: "Acreage", type: "number", width: 90 },
    { key: "squareFeet", label: "Gross SF", type: "number", width: 100 },
    { key: "yearBuilt", label: "Year Built", type: "number", width: 90 },
    { key: "lastSaleDate", label: "Last Sale Date", type: "date", width: 130 },
    { key: "lastSalePrice", label: "Last Sale Price", type: "money", width: 130 },
    { key: "deal", label: "Deal", type: "select", options: ["Deal"], width: 100 },
    { key: "dealStage", label: "Pipeline Stage", type: "select", options: dealStages, width: 140 },
    { key: "companies", label: "Companies", type: "readonly", width: 180 },
    { key: "latestNote", label: "Latest Note", type: "readonly", width: 240 },
    { key: "neighborhood", label: "Neighborhood", type: "text", width: 140 },
    { key: "askingPrice", label: "Asking Price", type: "money", width: 130 },
    { key: "units", label: "Units", type: "number", width: 80 },
    { key: "notes", label: "Notes", type: "multiline", width: 220 },
    { key: "updatedAt", label: "Updated", type: "readonly", width: 120 },
  ];
  const withRole = (p: (typeof rows)[number], role: string) => p.contacts.filter((x) => parseJsonList(x.contact.roles).includes(role)).map((x) => aqFullName(x.contact)).join(", ") || null;
  const gridRows: GridRow[] = rows.map((p) => ({
    id: p.id,
    href: `/acquisitions/properties/${p.id}`,
    address: p.address,
    city: p.city,
    state: p.state,
    county: p.county,
    businessName: p.businessName,
    assetType: p.assetType,
    parcelId: p.parcelId,
    owners: withRole(p, "Owner"),
    operators: withRole(p, "Operator"),
    acreage: p.acreage,
    squareFeet: p.squareFeet,
    yearBuilt: p.yearBuilt,
    lastSaleDate: iso(p.lastSaleDate),
    lastSalePrice: p.lastSalePrice,
    deal: parseJsonList(p.stages).includes("Deal") ? "Deal" : null,
    dealStage: p.dealStage,
    companies: p.companies.map((x) => x.company.name).join(", ") || null,
    latestNote: p.aqNotes[0]?.body ?? null,
    neighborhood: p.neighborhood,
    askingPrice: p.askingPrice,
    units: p.units,
    notes: p.notes,
    updatedAt: iso(p.updatedAt),
  }));
  return (
    <>
      <PageHeader
        title="Properties"
        subtitle={`${total.toLocaleString()} properties · click any cell to edit, drag headers to arrange`}
        actions={
          <Link href="/acquisitions/properties/new" className="btn-primary">
            New property
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <SearchForm action="/acquisitions/properties" q={q} placeholder="Search address, business, county, parcel, company or person">
          <div className="w-48">
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
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <AqGrid kind="property" columns={columns} rows={gridRows} empty="No properties match." />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
