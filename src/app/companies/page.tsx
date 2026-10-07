import Link from "next/link";
import { ZoomBox } from "@/components/zoom-box";
import { checkLabel } from "@/lib/ranges";
import { prisma } from "@/lib/db";
import { companiesWhere, companyFiltersFrom, companyFiltersQuery } from "@/lib/company-filters";
import { ExportButton } from "./export-button";
import { PageHeader, Pager } from "@/components/ui";
import { ListFilters } from "@/components/list-filters";
import { RoleCell } from "@/components/role-cell";
import { AssetCell } from "@/components/asset-cell";
import { LocationCell } from "@/components/location-cell";
import { parseList } from "@/lib/taxonomy";
import { fmtDate, str } from "@/lib/format";
import { CompanyLogo } from "@/components/company-logo";

export const metadata = { title: "Companies" };

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filters = companyFiltersFrom(sp);
  const { q, roles, assets, state } = filters;
  const page = Math.max(1, Number(str(sp.page)) || 1);
  // the list and its Excel export share one definition of the filters ("Not available" = asset classes never filled in)
  const where = companiesWhere(filters);

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

  const makeHref = (p: number) => `/companies?${companyFiltersQuery(filters, { page: String(p) })}`;
  const summary = [q ? `"${q}"` : "", roles.join(", "), assets.map((a) => (a === "Not available" ? "no asset classes" : a)).join(", "), state].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${total.toLocaleString()} companies`}
        actions={
          <>
            <ExportButton query={companyFiltersQuery(filters).toString()} total={total} summary={summary} />
            <Link href="/companies/new" className="btn-primary">
              New company
            </Link>
          </>
        }
      />
      <div className="px-8 py-4">
        <div className="flex flex-wrap items-center gap-3"><ListFilters basePath="/companies" initial={{ q, roles, assets, state }} placeholder="Search name, city, or contact email" withState /><div id="zoom-tools" className="ml-auto" /></div>
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
        <ZoomBox id="companies"><table className="table dense w-full min-w-[1100px]">
          <thead>
            <tr>
              <th>Company</th>
              <th>Roles</th>
              <th>Asset classes</th>
              <th>Deal locations</th>
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
                <td>
                  <LocationCell companyId={c.id} text={c.criteria?.geographyNotes ?? null} />
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
                <td colSpan={10} className="py-10 text-center text-muted">
                  No companies match.
                </td>
              </tr>
            )}
          </tbody>
        </table></ZoomBox>
        </div>
      </div>
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
