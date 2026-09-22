import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ROLES, aqFullName, parseJsonList } from "@/lib/acquisitions";
import { MultiSelect } from "@/components/multi-select";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { AqGrid } from "../grid";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/** Contacts as a sheet: the people around the properties, every column draggable and resizable, every cell editable; the company is a dropdown of the companies in this side. */
export default async function AqContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const roles = list(sp.role);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqContactWhereInput = {
    AND: [
      q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] } : {},
      roles.length ? { OR: roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {},
    ],
  };
  const [total, rows, companies] = await Promise.all([
    prisma.aqContact.count({ where }),
    prisma.aqContact.findMany({ where, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }, { firstName: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { _count: { select: { properties: true } } } }),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, domain: true, website: true } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    u.set("page", String(p));
    return `/acquisitions/contacts?${u}`;
  };
  const columns: GridColumn[] = [
    { key: "fullName", label: "Name", type: "readonly", width: 180 },
    { key: "firstName", label: "First Name", type: "text", width: 130 },
    { key: "lastName", label: "Last Name", type: "text", width: 140 },
    { key: "email", label: "Email", type: "email", width: 220 },
    { key: "phone", label: "Phone", type: "tel", width: 140 },
    { key: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name, domain: c.domain ?? c.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null })), width: 200, logoKey: "companyId" },
    { key: "roles", label: "Roles", type: "tokens", options: AQ_ROLES, width: 170 },
    { key: "notes", label: "Notes", type: "multiline", width: 240 },
    { key: "properties", label: "Properties", type: "readonly", width: 90 },
    { key: "lastActivityAt", label: "Last Activity", type: "readonly", width: 120 },
  ];
  const gridRows: GridRow[] = rows.map((c) => ({
    id: c.id,
    href: `/acquisitions/contacts/${c.id}`,
    fullName: aqFullName(c),
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    companyId: c.companyId,
    roles: parseJsonList(c.roles),
    notes: c.notes,
    properties: String(c._count.properties),
    lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
  }));
  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${total.toLocaleString()} contacts · click any cell to edit, drag headers to arrange`}
        actions={
          <Link href="/acquisitions/contacts/new" className="btn-primary">
            New contact
          </Link>
        }
      />
      <div className="px-6 py-2">
        <SearchForm action="/acquisitions/contacts" q={q} placeholder="Search name, email, phone, or company">
          <div className="w-56">
            <MultiSelect name="role" options={AQ_ROLES} selected={roles} placeholder="Any role" />
          </div>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <AqGrid kind="contact" columns={columns} rows={gridRows} empty="No contacts match. Emails from the Acquisitions mailbox add people here on their own; New contact adds one by hand." />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
