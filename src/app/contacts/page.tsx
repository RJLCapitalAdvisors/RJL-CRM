import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Pager, RoleChips } from "@/components/ui";
import { ListFilters } from "@/components/list-filters";
import { fmtDate, fullName, str } from "@/lib/format";
import { parseList } from "@/lib/taxonomy";
import { CompanyLogo } from "@/components/company-logo";

export const metadata = { title: "Contacts" };

export const dynamic = "force-dynamic";
const PAGE = 50;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const roles = list(sp.role);
  const assets = list(sp.asset);
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where: Prisma.ContactWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { company: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {},
      roles.length ? { OR: roles.map((r) => ({ roles: { contains: `"${r}"` } })) } : {},
      // asset classes flow from the company's criteria to its contacts; a contact's own criteria also counts
      assets.length ? { OR: assets.flatMap((a) => [{ criteria: { assetClasses: { contains: `"${a}"` } } }, { company: { criteria: { assetClasses: { contains: `"${a}"` } } } }]) } : {},
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { lastName: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { owner: true, company: { include: { criteria: { select: { assetClasses: true } } } } },
    }),
  ]);

  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    for (const r of roles) u.append("role", r);
    for (const a of assets) u.append("asset", a);
    u.set("page", String(p));
    return `/contacts?${u}`;
  };

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${total.toLocaleString()} contacts`}
        actions={
          <Link href="/contacts/new" className="btn-primary">
            New contact
          </Link>
        }
      />
      <div className="px-8 py-4">
        <ListFilters basePath="/contacts" initial={{ q, roles, assets }} placeholder="Search name, email, phone, or company" />
      </div>
      <div className="mx-8 flex h-[calc(100vh-150px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
        <table className="table dense w-full min-w-[1100px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Roles</th>
              <th>Asset classes</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id}>
                <td>
                  <Link href={`/contacts/${k.id}`} className="font-medium hover:underline">
                    {fullName(k)}
                  </Link>
                </td>
                <td className="text-muted">{k.email}</td>
                <td>
                  {k.company ? (
                    <Link href={`/companies/${k.company.id}`} className="flex items-center gap-2 hover:underline">
                      <CompanyLogo domain={k.company.domain} name={k.company.name} size={16} />
                      <span className="truncate">{k.company.name}</span>
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <RoleChips roles={k.roles} />
                </td>
                <td className="max-w-[240px] truncate" title={parseList(k.company?.criteria?.assetClasses).join(", ")}>
                  {parseList(k.company?.criteria?.assetClasses).join(", ") || <span className="text-muted">—</span>}
                </td>
                <td className="whitespace-nowrap">{k.owner?.name ?? <span className="text-muted">—</span>}</td>
                <td className="whitespace-nowrap text-xs">
                  {k.unsubscribed ? <span className="chip bg-stone-200">Unsubscribed</span> : k.bounceReason ? <span className="chip bg-amber-100">Bounced</span> : k.marketingContact ? <span className="chip bg-sky/50">Marketing</span> : <span className="text-muted">—</span>}
                </td>
                <td className="whitespace-nowrap text-muted">{fmtDate(k.lastActivityAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-muted">
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
