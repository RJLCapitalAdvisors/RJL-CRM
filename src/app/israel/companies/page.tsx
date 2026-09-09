import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function IlCompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const rows = await prisma.ilCompany.findMany({ where: { ...(q ? { name: { contains: q, mode: "insensitive" } } : {}), ...(kind ? { kind } : {}) }, orderBy: { name: "asc" }, include: { _count: { select: { contacts: true, apartments: true } } } });
  const kinds = [...new Set((await prisma.ilCompany.findMany({ select: { kind: true } })).map((c) => c.kind).filter(Boolean))] as string[];
  return (
    <>
      <PageHeader compact title="Companies" subtitle={`${rows.length} developers, agencies, law firms and others`} actions={<Link href="/israel/companies/new" className="btn-primary">New company</Link>} />
      <div className="px-6 py-5">
        <form method="get" className="mb-3 flex flex-wrap gap-2 text-sm">
          <input name="q" defaultValue={q} placeholder="Search" className="input w-64" />
          <select name="kind" defaultValue={kind} className="input w-48">
            <option value="">Any kind</option>
            {kinds.map((k) => <option key={k}>{k}</option>)}
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
                <th>Kind</th>
                <th>City</th>
                <th className="text-right">Contacts</th>
                <th className="text-right">Apartments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/israel/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.kind}</td>
                  <td>{c.city}</td>
                  <td className="text-right">{c._count.contacts}</td>
                  <td className="text-right">{c._count.apartments}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted">
                    No companies yet.
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
