import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IL_ACTIVE_STAGES, IL_STAGES, apartmentLine, nisShort, stageToneIl } from "@/lib/israel";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/** RJL Israel dashboard: the pipeline at a glance and what moved last. */
export default async function IsraelDashboard() {
  const [apartments, companies, contacts, notes] = await Promise.all([
    prisma.ilApartment.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.ilCompany.count(),
    prisma.ilContact.count(),
    prisma.ilNote.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { apartment: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } }, company: { select: { id: true, name: true } } } }),
  ]);
  const byStage = new Map<string, number>();
  for (const a of apartments) byStage.set(a.stage, (byStage.get(a.stage) ?? 0) + 1);
  const active = apartments.filter((a) => (IL_ACTIVE_STAGES as string[]).includes(a.stage));
  const value = active.reduce((s, a) => s + (a.priceNis ?? 0), 0);
  return (
    <>
      <PageHeader compact title="RJL Israel" subtitle={`${active.length} apartments in play · ${nisShort(value)} asking in total · ${contacts} contacts · ${companies} companies`} actions={<Link href="/israel/apartments/new" className="btn-primary">New apartment</Link>} />
      <div className="grid gap-4 px-6 py-5 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Pipeline</div>
          <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-4">
            {IL_STAGES.map((st) => (
              <Link key={st} href={`/israel/apartments?stage=${encodeURIComponent(st)}`} className={`rounded-md px-3 py-2 ${stageToneIl[st] ?? "bg-cream"}`}>
                <div className="text-2xl font-semibold">{byStage.get(st) ?? 0}</div>
                <div className="text-xs">{st}</div>
              </Link>
            ))}
          </div>
          <div className="border-t border-line px-4 py-3 text-sm font-semibold">Most recently touched</div>
          <ul className="divide-y divide-line">
            {apartments.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="font-medium hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{apartmentLine(a)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.priceNis && <span className="text-sm">{nisShort(a.priceNis)}</span>}
                  <span className={`chip text-[11px] ${stageToneIl[a.stage] ?? "bg-cream"}`}>{a.stage}</span>
                </div>
              </li>
            ))}
            {apartments.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No apartments yet. Add the first one.</li>}
          </ul>
        </div>
        <div className="card">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Latest notes</div>
          <ul className="divide-y divide-line">
            {notes.map((nt) => (
              <li key={nt.id} className="px-4 py-2.5 text-sm">
                <div className="text-xs text-muted">
                  {nt.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {nt.apartment && (
                    <>
                      {" · "}
                      <Link href={`/israel/apartments/${nt.apartment.id}`} className="hover:underline">
                        {nt.apartment.name}
                      </Link>
                    </>
                  )}
                  {nt.contact && (
                    <>
                      {" · "}
                      <Link href={`/israel/contacts/${nt.contact.id}`} className="hover:underline">
                        {[nt.contact.firstName, nt.contact.lastName].filter(Boolean).join(" ")}
                      </Link>
                    </>
                  )}
                  {nt.company && (
                    <>
                      {" · "}
                      <Link href={`/israel/companies/${nt.company.id}`} className="hover:underline">
                        {nt.company.name}
                      </Link>
                    </>
                  )}
                </div>
                <div className="whitespace-pre-wrap">{nt.body}</div>
              </li>
            ))}
            {notes.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Notes on apartments, contacts and companies show up here.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
