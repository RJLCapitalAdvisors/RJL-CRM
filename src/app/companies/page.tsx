import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ROLES, US_STATES } from "@/lib/taxonomy";
import { PageHeader, Pager, RoleChips, SearchForm, Chips } from "@/components/ui";
import { fmtDate, str } from "@/lib/format";

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
      <div className="mx-8 overflow-x-auto rounded-lg border border-line bg-paper">
        <table className="table w-full">
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
                  <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td>
                  <RoleChips roles={c.roles} />
                </td>
                <td className="whitespace-nowrap">{[c.city, c.state].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                <td>
                  <Chips items={c.criteria?.assetClasses ?? "[]"} max={3} />
                </td>
                <td>
                  <Chips items={c.criteria?.checkSizes ?? "[]"} tone="bg-sky-50 text-ink" max={3} />
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
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
