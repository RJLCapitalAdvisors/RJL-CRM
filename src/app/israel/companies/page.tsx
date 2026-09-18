import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, SearchForm } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";
import { IL_COMPANY_ROLES } from "@/lib/israel";
import { IlRoleCell } from "@/components/il-role-cell";
import { setIlCompanyRoles } from "../actions";
import { CompanyLogo } from "@/components/company-logo";
import { MultiSelect } from "@/components/multi-select";

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";
const PAGE = 50;

/** Companies: developers, agencies and the firms around a purchase. Same window as the RJL Capital Advisors list: logo by the name, the firms emailed most recently on top. */
export default async function IlCompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const roles = list(sp.role);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.IlCompanyWhereInput = {
    AND: [q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { contacts: { some: { email: { contains: q, mode: "insensitive" } } } }] } : {}, roles.length ? { OR: roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {}],
  };
  const [total, rows] = await Promise.all([
    prisma.ilCompany.count({ where }),
    prisma.ilCompany.findMany({ where, orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { name: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { _count: { select: { contacts: true, apartments: true } } } }),
  ]);
  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    u.set("page", String(p));
    return `/israel/companies?${u}`;
  };
  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${total.toLocaleString()} companies`}
        actions={
          <Link href="/israel/companies/new" className="btn-primary">
            New company
          </Link>
        }
      />
      <div className="px-6 py-2">
        <SearchForm action="/israel/companies" q={q} placeholder="Search name, city, or contact email">
          <div className="w-56">
            <MultiSelect name="role" options={IL_COMPANY_ROLES} selected={roles} placeholder="Any role" />
          </div>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full min-w-[900px]">
            <thead>
              <tr>
                <th>Company</th>
                <th>Roles</th>
                <th className="text-right">Contacts</th>
                <th className="text-right">Apartments</th>
                <th>Phone</th>
                <th>Website</th>
                <th>Location</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/israel/companies/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <CompanyLogo domain={c.domain ?? c.website?.replace(/^https?:\/\//, "").split("/")[0]} name={c.name} />
                      <span className="truncate">{c.name}</span>
                    </Link>
                  </td>
                  <td>
                    <IlRoleCell roles={c.roles} focus={c.sponsorFocus} options={IL_COMPANY_ROLES} action={setIlCompanyRoles.bind(null, c.id)} />
                  </td>
                  <td className="text-right">{c._count.contacts}</td>
                  <td className="text-right">{c._count.apartments}</td>
                  <td className="whitespace-nowrap">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="max-w-[220px] truncate text-muted">{c.website?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "—"}</td>
                  <td className="whitespace-nowrap">{c.city ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap text-muted">{c.lastActivityAt ? fmtDate(c.lastActivityAt) : <span title={`Added ${fmtDate(c.createdAt)}`}>—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted">
                    No companies match.
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
