import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ROLES, parseJsonList } from "@/lib/acquisitions";
import { US_STATES } from "@/lib/taxonomy";
import { MultiSelect } from "@/components/multi-select";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { AqGrid } from "../grid";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/** Companies as a sheet: sellers, operators and buyers, every column draggable and resizable, every cell editable. A company's roles flow to its contacts. */
export default async function AqCompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const roles = list(sp.role);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqCompanyWhereInput = {
    AND: [
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { website: { contains: q, mode: "insensitive" } }, { contacts: { some: { email: { contains: q, mode: "insensitive" } } } }] } : {},
      roles.length ? { OR: roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.aqCompany.count({ where }),
    prisma.aqCompany.findMany({ where, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { name: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { _count: { select: { contacts: true, properties: true } } } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    u.set("page", String(p));
    return `/acquisitions/companies?${u}`;
  };
  const columns: GridColumn[] = [
    { key: "name", label: "Company", type: "text", width: 220 },
    { key: "roles", label: "Roles", type: "tokens", options: AQ_ROLES, width: 170 },
    { key: "phone", label: "Phone", type: "tel", width: 140 },
    { key: "website", label: "Website", type: "url", width: 200 },
    { key: "city", label: "City", type: "text", width: 130 },
    { key: "state", label: "State", type: "select", options: Object.keys(US_STATES), width: 80 },
    { key: "notes", label: "Notes", type: "multiline", width: 240 },
    { key: "contacts", label: "Contacts", type: "readonly", width: 90 },
    { key: "properties", label: "Properties", type: "readonly", width: 90 },
    { key: "lastActivityAt", label: "Last Activity", type: "readonly", width: 120 },
  ];
  const gridRows: GridRow[] = rows.map((c) => ({
    id: c.id,
    href: `/acquisitions/companies/${c.id}`,
    name: c.name,
    roles: parseJsonList(c.roles),
    phone: c.phone,
    website: c.website,
    city: c.city,
    state: c.state,
    notes: c.notes,
    contacts: String(c._count.contacts),
    properties: String(c._count.properties),
    lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
  }));
  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${total.toLocaleString()} companies · click any cell to edit, drag headers to arrange`}
        actions={
          <Link href="/acquisitions/companies/new" className="btn-primary">
            New company
          </Link>
        }
      />
      <div className="px-6 py-2">
        <SearchForm action="/acquisitions/companies" q={q} placeholder="Search name, city, website, or contact email">
          <div className="w-56">
            <MultiSelect name="role" options={AQ_ROLES} selected={roles} placeholder="Any role" />
          </div>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <AqGrid kind="company" columns={columns} rows={gridRows} empty="No companies match." />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
