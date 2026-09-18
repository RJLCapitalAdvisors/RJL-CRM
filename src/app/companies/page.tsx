import Link from "next/link";
import { checkLabel } from "@/lib/ranges";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager } from "@/components/ui";
import { ListFilters } from "@/components/list-filters";
import { RoleCell } from "@/components/role-cell";
import { AssetCell } from "@/components/asset-cell";
import { parseList } from "@/lib/taxonomy";
import { fmtDate, str } from "@/lib/format";
import { CompanyLogo } from "@/components/company-logo";

export const metadata = { title: "Companies" };

export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const roles = list(sp.role);
  const assets = list(sp.asset);
  const state = str(sp.state);
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where: Prisma.CompanyWhereInput = {
    AND: [
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { contacts: { some: { email: { contains: q, mode: "insensitive" } } } }] } : {},
      roles.length ? { OR: roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {},
      assets.length ? { OR: assets.map((a) => ({ criteria: { assetClasses: { contains: `"${a}"` } } })) } : {},
      state ? { state } : {},
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { owner: true, criteria: true, _count: { select: { contacts: true, deals: true } } },
    }),
  ]);

  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    for (const a of assets) u.append("asset", a);
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
        <ListFilters basePath="/companies" initial={{ q, roles, assets, state }} placeholder="Search name, city, or contact email" withState />
      </div>
      <div className="mx-8 flex h-[calc(100vh-176px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
        <table className="table dense w-full min-w-[1100px]">
          <thead>
            <tr>
              <th>Company</th>
              <th>Roles</th>
              <th>Asset classes</th>
              <th>Check size</th>
              <th className="text-right">Contacts</th>
              <th className="text-right">Deals</th>
              <th>Owner</th>
              <th>Last activity</th>
              <th>Location</th>
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
                  <RoleCell companyId={c.id} roles={c.roles} />
                </td>
                <td>
                  <AssetCell companyId={c.id} assetClasses={parseList(c.criteria?.assetClasses)} />
                </td>
                <td className="whitespace-nowrap">{c.criteria && checkLabel(c.criteria, "") ? checkLabel(c.criteria) : <span className="text-muted">—</span>}</td>
                <td className="text-right">{c._count.contacts}</td>
                <td className="text-right">{c._count.deals}</td>
                <td className="whitespace-nowrap">{c.owner?.name ?? <span className="text-muted">—</span>}</td>
                <td className="whitespace-nowrap text-muted">{fmtDate(c.lastActivityAt)}</td>
                <td className="whitespace-nowrap">{[c.city, c.state].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
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
