import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";
import { IL_ROLES, ilFullName, nisShort } from "@/lib/israel";
import { IlRoleCell } from "@/components/il-role-cell";
import { CompanyLogo } from "@/components/company-logo";
import { setIlContactRoles } from "../actions";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";
const PAGE = 50;

/** Contacts: buyers, sellers and sales agents, linked through to their companies. Same window as the RJL Capital Advisors list. */
export default async function IlContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const role = str(sp.role);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.IlContactWhereInput = {
    AND: [
      q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] } : {},
      role ? { roles: { contains: `"${role}"` } } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.ilContact.count({ where }),
    prisma.ilContact.findMany({ where, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }, { firstName: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { company: { select: { id: true, name: true, domain: true, website: true } } } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (role) u.set("role", role);
    u.set("page", String(p));
    return `/israel/contacts?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${total.toLocaleString()} contacts`}
        actions={
          <Link href="/israel/contacts/new" className="btn-primary">
            New contact
          </Link>
        }
      />
      <div className="px-6 py-2">
        <SearchForm action="/israel/contacts" q={q} placeholder="Search name, email, phone, or company">
          <select name="role" defaultValue={role} className="input w-40">
            <option value="">Any role</option>
            {IL_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full min-w-[1000px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Roles</th>
                <th>Phone</th>
                <th>Language</th>
                <th className="text-right">Budget</th>
                <th>Wants</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.id}>
                  <td>
                    <Link href={`/israel/contacts/${k.id}`} className="font-medium hover:underline">
                      {ilFullName(k)}
                    </Link>
                  </td>
                  <td className="text-muted">{k.email}</td>
                  <td>
                    {k.company ? (
                      <Link href={`/israel/companies/${k.company.id}`} className="flex items-center gap-2 hover:underline">
                        <CompanyLogo domain={k.company.domain ?? k.company.website?.replace(/^https?:\/\//, "").split("/")[0]} name={k.company.name} />
                        <span className="truncate">{k.company.name}</span>
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <IlRoleCell roles={k.roles} options={IL_ROLES} action={setIlContactRoles.bind(null, k.id)} />
                  </td>
                  <td className="whitespace-nowrap">{k.phone}</td>
                  <td>{k.language}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{k.budgetMaxNis ? `${k.budgetMinNis ? `${nisShort(k.budgetMinNis)} to ` : "up to "}${nisShort(k.budgetMaxNis)}` : ""}</td>
                  <td className="max-w-[220px] truncate text-xs text-muted">{[k.wantsCities, k.wantsRooms ? `${k.wantsRooms} rooms` : null].filter(Boolean).join(" · ")}</td>
                  <td className="whitespace-nowrap text-muted">{k.lastActivityAt ? fmtDate(k.lastActivityAt) : <span title={`Added ${fmtDate(k.createdAt)}`}>—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-muted">
                    No contacts match.
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
