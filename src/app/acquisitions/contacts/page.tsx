import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ROLES } from "@/lib/acquisitions";
import { contactColumns, contactGridRow } from "./columns";
import { MultiSelect } from "@/components/multi-select";
import { AqGrid } from "../grid";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

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
  const columns = contactColumns(companies, operatorsOnly);
  const gridRows = rows.map(contactGridRow);
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
