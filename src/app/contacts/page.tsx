import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/taxonomy";
import { PageHeader, Pager, RoleChips, SearchForm } from "@/components/ui";
import { fmtDate, fullName, str } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const role = str(sp.role);
  const status = str(sp.status);
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where: Prisma.ContactWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
              { company: { name: { contains: q } } },
            ],
          }
        : {},
      role ? { roles: { contains: `"${role}"` } } : {},
      status === "marketing" ? { marketingContact: true, unsubscribed: false, bounceReason: null } : {},
      status === "unsubscribed" ? { unsubscribed: true } : {},
      status === "bounced" ? { bounceReason: { not: null } } : {},
      status === "noemail" ? { email: null } : {},
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { owner: true, company: true },
    }),
  ]);

  const makeHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (role) u.set("role", role);
    if (status) u.set("status", status);
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
        <SearchForm action="/contacts" q={q} placeholder="Search name, email, phone, or company">
          <select name="role" defaultValue={role} className="input w-44">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="input w-44">
            <option value="">Any email status</option>
            <option value="marketing">Marketing contact</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Hard bounced</option>
            <option value="noemail">No email</option>
          </select>
        </SearchForm>
      </div>
      <div className="mx-8 overflow-x-auto rounded-lg border border-line bg-paper">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Roles</th>
              <th>Phone</th>
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
                    <Link href={`/companies/${k.company.id}`} className="hover:underline">
                      {k.company.name}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <RoleChips roles={k.roles} />
                </td>
                <td className="whitespace-nowrap text-muted">{k.phone}</td>
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
      <Pager page={page} pageSize={PAGE} total={total} makeHref={makeHref} />
    </>
  );
}
