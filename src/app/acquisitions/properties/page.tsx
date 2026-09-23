import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ASSET_TYPES, AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, aqFullName, parseJsonList } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { US_STATES } from "@/lib/taxonomy";
import { MultiSelect } from "@/components/multi-select";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { PropertyPanes } from "./panes";

export const metadata = { title: "Properties" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

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
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name, domain: c.domain ?? c.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null }));

  const propertyColumns: GridColumn[] = [
    { key: "address", label: "Property Address", type: "text", width: 220 },
    { key: "city", label: "City", type: "text", width: 130 },
    { key: "state", label: "State", type: "select", options: Object.keys(US_STATES), width: 80 },
    { key: "county", label: "County", type: "text", width: 120 },
    { key: "businessName", label: "Current Business", type: "text", width: 180 },
    { key: "assetType", label: "Asset Type", type: "select", options: AQ_ASSET_TYPES, width: 130 },
    { key: "parcelId", label: "Parcel ID", type: "text", width: 130 },
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
  // the contact card's fields, in the same shape as the Contacts sheet
  const personColumns = (operator: boolean): GridColumn[] => [
    { key: "fullName", label: operator ? "Operator" : "Owner", type: "readonly", width: 180 },
    { key: "roles", label: "Roles", type: "tokens", options: AQ_ROLES, width: 150 },
    { key: "companyId", label: "Company", type: "select", options: companyOptions, width: 200, logoKey: "companyId" },
    ...(operator
      ? ([
          { key: "operatorBrandName", label: "Operator Brand Name", type: "text", width: 180 },
          { key: "website", label: "Website", type: "url", width: 180 },
          { key: "operatorEntityName", label: "Operator Entity Name", type: "text", width: 180 },
          { key: "directoryOperatorName", label: "Directory Operator Name", type: "text", width: 180 },
          { key: "storePhone", label: "Store Phone (Google)", type: "tel", width: 150 },
          { key: "directoryOperatorPhone", label: "Directory Operator Phone", type: "tel", width: 160 },
          { key: "operatorTotalLocations", label: "Operator Total Locations", type: "number", width: 120 },
          { key: "operatorPipelineStatus", label: "Operator Pipeline Status", type: "select", options: AQ_OPERATOR_STATUSES, width: 160 },
        ] as GridColumn[])
      : []),
    { key: "firstName", label: "First Name", type: "text", width: 120 },
    { key: "lastName", label: "Last Name", type: "text", width: 130 },
    { key: "phone", label: "Primary Phone", type: "tel", width: 140 },
    { key: "secondaryPhone", label: "Secondary Phone", type: "tel", width: 140 },
    { key: "otherPhones", label: "Other Phones", type: "lines", width: 160 },
    { key: "email", label: "Primary Email", type: "email", width: 220 },
    { key: "emails", label: "Email (public record)", type: "lines", width: 220 },
    { key: "mailingAddress", label: "Mailing Address", type: "text", width: 240 },
    { key: "lastCallDate", label: "Last Call Date", type: "date", width: 130 },
    { key: "callResult", label: "Call Result", type: "select", options: AQ_STAGES, width: 140 },
    { key: "callBackAt", label: "Callback Target", type: "date", width: 130 },
    { key: "followUpAt", label: "Follow Up Date", type: "date", width: 130 },
    { key: "latestNote", label: "Latest Call Note", type: "readonly", width: 240 },
    { key: "notes", label: "Notes", type: "multiline", width: 240 },
  ];

  type C = (typeof rows)[number]["contacts"][number]["contact"];
  const personRow = (propertyId: string, c: C | undefined, others: number): GridRow =>
    c
      ? {
          id: propertyId,
          contactId: c.id,
          href: `/acquisitions/contacts/${c.id}`,
          fullName: aqFullName(c) + (others ? ` (+${others})` : ""),
          roles: parseJsonList(c.roles),
          companyId: c.companyId,
          operatorBrandName: c.operatorBrandName,
          website: c.website,
          operatorEntityName: c.operatorEntityName,
          directoryOperatorName: c.directoryOperatorName,
          storePhone: c.storePhone,
          directoryOperatorPhone: c.directoryOperatorPhone,
          operatorTotalLocations: c.operatorTotalLocations,
          operatorPipelineStatus: c.operatorPipelineStatus,
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          secondaryPhone: c.secondaryPhone,
          otherPhones: c.otherPhones,
          email: c.email,
          emails: c.emails,
          mailingAddress: c.mailingAddress,
          lastCallDate: iso(c.lastCallDate),
          callResult: c.callResult,
          callBackAt: iso(c.callBackAt),
          followUpAt: iso(c.followUpAt),
          latestNote: c.aqNotes[0]?.body ?? null,
          notes: c.notes,
        }
      : { id: propertyId, contactId: null, href: `/acquisitions/properties/${propertyId}`, fullName: "—" };
  const byRole = (p: (typeof rows)[number], role: string) => p.contacts.map((x) => x.contact).filter((c) => parseJsonList(c.roles).includes(role));

  const propertyRows: GridRow[] = rows.map((p) => ({
    id: p.id,
    href: `/acquisitions/properties/${p.id}`,
    address: p.address,
    city: p.city,
    state: p.state,
    county: p.county,
    businessName: p.businessName,
    assetType: p.assetType,
    parcelId: p.parcelId,
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
  const ownerRows = rows.map((p) => {
    const list = byRole(p, "Owner");
    return personRow(p.id, list[0], Math.max(0, list.length - 1));
  });
  const operatorRows = rows.map((p) => {
    const list = byRole(p, "Operator");
    return personRow(p.id, list[0], Math.max(0, list.length - 1));
  });

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
        <PropertyPanes rows={{ properties: propertyRows, owners: ownerRows, operators: operatorRows }} columns={{ properties: propertyColumns, owners: personColumns(false), operators: personColumns(true) }} />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
