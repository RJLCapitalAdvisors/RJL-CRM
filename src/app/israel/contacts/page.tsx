import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IL_ROLES, nisShort, parseJsonList } from "@/lib/israel";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function IlContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const role = typeof sp.role === "string" ? sp.role : "";
  const rows = await prisma.ilContact.findMany({
    where: { ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] } : {}), ...(role ? { roles: { contains: `"${role}"` } } : {}) },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { company: { select: { id: true, name: true } } },
  });
  return (
    <>
      <PageHeader compact title="Contacts" subtitle={`${rows.length} buyers, sellers, agents, developers and advisors`} actions={<Link href="/israel/contacts/new" className="btn-primary">New contact</Link>} />
      <div className="px-6 py-5">
        <form method="get" className="mb-3 flex flex-wrap gap-2 text-sm">
          <input name="q" defaultValue={q} placeholder="Search" className="input w-64" />
          <select name="role" defaultValue={role} className="input w-48">
            <option value="">Any role</option>
            {IL_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="btn-secondary" type="submit">
            Filter
          </button>
        </form>
        <div className="card overflow-hidden">
          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Roles</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Email</th>
                <th className="text-right">Budget</th>
                <th>Wants</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/israel/contacts/${p.id}`} className="font-medium hover:underline">
                      {[p.firstName, p.lastName].filter(Boolean).join(" ") || p.email}
                    </Link>
                  </td>
                  <td>{parseJsonList(p.roles).join(", ")}</td>
                  <td>{p.company && <Link href={`/israel/companies/${p.company.id}`} className="hover:underline">{p.company.name}</Link>}</td>
                  <td>{p.phone}</td>
                  <td className="text-xs">{p.email}</td>
                  <td className="text-right">{p.budgetMaxNis ? `${p.budgetMinNis ? `${nisShort(p.budgetMinNis)} to ` : "up to "}${nisShort(p.budgetMaxNis)}` : ""}</td>
                  <td className="text-xs text-muted">{[p.wantsCities, p.wantsRooms ? `${p.wantsRooms} rooms` : null].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No contacts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
