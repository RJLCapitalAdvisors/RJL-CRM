import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";
import { AQ_ROLES, aqFullName } from "@/lib/acquisitions";
import { IlRoleCell } from "@/components/il-role-cell";
import { CompanyLogo } from "@/components/company-logo";
import { MultiSelect } from "@/components/multi-select";
import { setAqContactRoles } from "../actions";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/** Contacts: the people around the properties, with their company (logo) and roles; the firms emailed most recently on top. */
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
  const [total, rows] = await Promise.all([
    prisma.aqContact.count({ where }),
    prisma.aqContact.findMany({ where, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }, { firstName: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { company: { select: { id: true, name: true, domain: true, website: true } } } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    u.set("page", String(p));
    return `/acquisitions/contacts?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${total.toLocaleString()} contacts`}
        actions={
          <Link href="/acquisitions/contacts/new" className="btn-primary">
            New contact
          </Link>
        }
      />
      <div className="px-8 py-4">
        <SearchForm action="/acquisitions/contacts" q={q} placeholder="Search name, email, phone, or company">
          <div className="w-56">
            <MultiSelect name="role" options={AQ_ROLES} selected={roles} placeholder="Any role" />
          </div>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-260px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full min-w-[900px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Roles</th>
                <th>Phone</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/acquisitions/contacts/${c.id}`} className="font-medium hover:underline">
                      {aqFullName(c)}
                    </Link>
                  </td>
                  <td className="text-muted">{c.email ?? "—"}</td>
                  <td>
                    {c.company ? (
                      <Link href={`/acquisitions/companies/${c.company.id}`} className="flex items-center gap-2 hover:underline">
                        <CompanyLogo domain={c.company.domain ?? c.company.website?.replace(/^https?:\/\//, "").split("/")[0]} name={c.company.name} />
                        <span className="truncate">{c.company.name}</span>
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <IlRoleCell roles={c.roles} options={AQ_ROLES} action={setAqContactRoles.bind(null, c.id)} />
                  </td>
                  <td className="whitespace-nowrap">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap text-muted">{c.lastActivityAt ? fmtDate(c.lastActivityAt) : <span title={`Added ${fmtDate(c.createdAt)}`}>—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted">
                    No contacts match. Emails from the Acquisitions mailbox add people here on their own; New contact adds one by hand.
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
