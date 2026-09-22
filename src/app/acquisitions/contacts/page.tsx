import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ROLES, AQ_STAGES, aqFullName, parseJsonList } from "@/lib/acquisitions";
import { MultiSelect } from "@/components/multi-select";
import type { GridColumn, GridRow } from "@/components/data-grid";
import { AqGrid } from "../grid";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Contacts as a sheet (Sep 22, 2026): every field on the contact card is a column, in your order and width, every
 * cell editable in place. The Owners, Operators and Buyers links in the nav open it filtered to that role.
 */
export default async function AqContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const roles = list(sp.role);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.AqContactWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { emails: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { secondaryPhone: { contains: q } },
              { otherPhones: { contains: q } },
              { storePhone: { contains: q } },
              { operatorBrandName: { contains: q, mode: "insensitive" } },
              { operatorEntityName: { contains: q, mode: "insensitive" } },
              { company: { name: { contains: q, mode: "insensitive" } } },
              { properties: { some: { property: { address: { contains: q, mode: "insensitive" } } } } },
            ],
          }
        : {},
      roles.length ? { OR: roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {},
    ],
  };
  const [total, rows, companies] = await Promise.all([
    prisma.aqContact.count({ where }),
    prisma.aqContact.findMany({
      where,
      orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { properties: { include: { property: { select: { address: true } } } }, aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } },
    }),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, domain: true, website: true } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    u.set("page", String(p));
    return `/acquisitions/contacts?${u}`;
  };
  const operatorsOnly = roles.length === 1 && roles[0] === "Operator";
  const columns: GridColumn[] = [
    { key: "fullName", label: "Name", type: "readonly", width: 180 },
    { key: "roles", label: "Roles", type: "tokens", options: AQ_ROLES, width: 160 },
    { key: "firstName", label: "First Name", type: "text", width: 120 },
    { key: "lastName", label: "Last Name", type: "text", width: 130 },
    { key: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name, domain: c.domain ?? c.website?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null })), width: 200, logoKey: "companyId" },
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
    { key: "properties", label: "Properties", type: "readonly", width: 220 },
    { key: "operatorBrandName", label: "Operator Brand Name", type: "text", width: 180 },
    { key: "website", label: "Website", type: "url", width: 180 },
    { key: "operatorEntityName", label: "Operator Entity Name", type: "text", width: 180 },
    { key: "directoryOperatorName", label: "Directory Operator Name", type: "text", width: 180 },
    { key: "storePhone", label: "Store Phone (Google)", type: "tel", width: 150 },
    { key: "directoryOperatorPhone", label: "Directory Operator Phone", type: "tel", width: 160 },
    { key: "operatorTotalLocations", label: "Operator Total Locations", type: "number", width: 120 },
    { key: "notes", label: "Notes", type: "multiline", width: 240 },
    { key: "lastActivityAt", label: "Last Activity", type: "readonly", width: 120 },
  ];
  // on the Operators view the operator details come right after the company
  if (operatorsOnly) {
    const isOp = (c: GridColumn) => c.key.startsWith("operator") || c.key === "website" || c.key.startsWith("directory") || c.key === "storePhone";
    const op = columns.filter(isOp), rest = columns.filter((c) => !isOp(c));
    columns.splice(0, columns.length, ...rest.slice(0, 5), ...op, ...rest.slice(5));
  }
  const gridRows: GridRow[] = rows.map((c) => ({
    id: c.id,
    href: `/acquisitions/contacts/${c.id}`,
    fullName: aqFullName(c),
    roles: parseJsonList(c.roles),
    firstName: c.firstName,
    lastName: c.lastName,
    companyId: c.companyId,
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
    properties: c.properties.map((x) => x.property.address).join(", ") || null,
    operatorBrandName: c.operatorBrandName,
    website: c.website,
    operatorEntityName: c.operatorEntityName,
    directoryOperatorName: c.directoryOperatorName,
    storePhone: c.storePhone,
    directoryOperatorPhone: c.directoryOperatorPhone,
    operatorTotalLocations: c.operatorTotalLocations,
    notes: c.notes,
    lastActivityAt: iso(c.lastActivityAt),
  }));
  const one = roles.length === 1 ? roles[0] : null;
  return (
    <>
      <PageHeader
        title={one ? `${one}s` : "Contacts"}
        subtitle={`${total.toLocaleString()} ${one ? one.toLowerCase() + "s" : "contacts"} · click any cell to edit, drag headers to arrange`}
        actions={
          <Link href={`/acquisitions/contacts/new${one ? `?role=${one}` : ""}`} className="btn-primary">
            New {one ? one.toLowerCase() : "contact"}
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <SearchForm action="/acquisitions/contacts" q={q} placeholder="Search name, email, phone, brand, company or property">
          <div className="w-56">
            <MultiSelect name="role" options={AQ_ROLES} selected={roles} placeholder="Any role" />
          </div>
        </SearchForm>
        <div id="grid-tools" className="ml-auto" />
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <AqGrid kind="contact" columns={columns} rows={gridRows} gridId={operatorsOnly ? "contact-operators" : "contact"} empty="No contacts match. Emails from the Acquisitions mailbox add people here on their own; New contact adds one by hand." />
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
