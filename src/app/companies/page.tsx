import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ROLES, US_STATES } from "@/lib/taxonomy";
import { PageHeader, Pager, RoleChips, SearchForm } from "@/components/ui";
import { parseList } from "@/lib/taxonomy";
import { fmtDate, str } from "@/lib/format";
import { CompanyLogo } from "@/components/company-logo";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const role = str(sp.role);
  const state = str(sp.state);
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where: Prisma.CompanyWhereInput = {
    AND: [
      q ? { OR: [{ name: { contains: q } }, { city: { contains: q } }, { contacts: { some: { email: { contains: q } } } }] } : {},
      role ? { roles: { contains: `"${role}"` } } : {},
      state ? { state } : {},
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: [{ lastActivityAt: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { owner: true, criteria: true, _count: { select: { contacts: true, deals: true } } },
    }),
  ]);

  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (role) u.set("role", role);
    if (state) u.set("state", state);
    u.set("page", String(p));
    return `/companies?${u}`;
  };

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${total.toLocaleString()} companies`}
        actions={
          <Link href="/companies/new" className="btn-primary">
            New company
          </Link>
        }
      />
      <div className="px-8 py-4">
        <SearchForm action="/companies" q={q} placeholder="Search name, city, or contact email">
          <select name="role" defaultValue={role} className="input w-44">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select name="state" defaultValue={state} className="input w-40">
            <option value="">All states</option>
            {Object.keys(US_STATES).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </SearchForm>
      </div>
      <div className="mx-8 flex h-[calc(100vh-260px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
        <table className="table dense w-full min-w-[1100px]">
          <thead>
            <tr>
              <th>Company</th>
              <th>Roles</th>
              <th>Location</th>
              <th>Asset classes</th>
              <th>Check sizes</th>
              <th className="text-right">Contacts</th>
              <th className="text-right">Deals</th>
              <th>Owner</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/companies/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <CompanyLogo domain={c.domain} name={c.name} />
                    <span className="truncate">{c.name}</span>
                  </Link>
                </td>
                <td>
                  <RoleChips roles={c.roles} />
                </td>
                <td className="whitespace-nowrap">{[c.city, c.state].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                <td className="max-w-[240px] truncate" title={parseList(c.criteria?.assetClasses).join(", ")}>
                  {parseList(c.criteria?.assetClasses).join(", ") || <span className="text-muted">—</span>}
                </td>
                <td className="max-w-[220px] truncate" title={parseList(c.criteria?.checkSizes).join(", ")}>
                  {parseList(c.criteria?.checkSizes).join(", ") || <span className="text-muted">—</span>}
                </td>
                <td className="text-right">{c._count.contacts}</td>
                <td className="text-right">{c._count.deals}</td>
                <td className="whitespace-nowrap">{c.owner?.name ?? <span className="text-muted">—</span>}</td>
                <td className="whitespace-nowrap text-muted">{fmtDate(c.lastActivityAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-muted">
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
