import Link from "next/link";
import { prisma } from "@/lib/db";
import { ACTIVE_STAGES, stageTone } from "@/lib/taxonomy";
import { PageHeader } from "@/components/ui";
import { fmtDate, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [companies, contacts, deals, activeDeals, byStage, recentContacts] = await Promise.all([
    prisma.company.count(),
    prisma.contact.count(),
    prisma.deal.count(),
    prisma.deal.findMany({
      where: { stage: { in: [...ACTIVE_STAGES] } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      include: { owner: true },
    }),
    prisma.deal.groupBy({ by: ["stage"], _count: { _all: true } }),
    prisma.contact.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { company: true } }),
  ]);
  const stageCount = new Map(byStage.map((s) => [s.stage, s._count._all]));
  const active = ACTIVE_STAGES.reduce((n, s) => n + (stageCount.get(s) ?? 0), 0);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="RJL Capital Advisors pipeline at a glance" />
      <div className="grid grid-cols-4 gap-4 px-8 py-6">
        <Stat label="Active deals" value={active} href="/deals" />
        <Stat label="Closed" value={stageCount.get("Deal Closed") ?? 0} href="/deals" />
        <Stat label="Companies" value={companies} href="/companies" />
        <Stat label="Contacts" value={contacts} href="/contacts" />
      </div>

      <div className="grid grid-cols-3 gap-6 px-8 pb-10">
        <section className="card col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">Recently updated active deals</h2>
            <Link href="/deals" className="text-sm text-sky-600 hover:underline">
              Open board
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {activeDeals.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/deals/${d.id}`} className="block truncate font-medium hover:underline">
                    {d.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {d.owner?.name ?? "Unassigned"} · updated {fmtDate(d.updatedAt)}
                  </div>
                </div>
                <span className={`chip border ${stageTone(d.stage)}`}>{d.stage}</span>
              </li>
            ))}
            {activeDeals.length === 0 && <li className="px-5 py-6 text-sm text-muted">No active deals yet.</li>}
          </ul>
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">Pipeline</h2>
            <span className="text-xs text-muted">{deals.toLocaleString()} total</span>
          </div>
          <ul className="divide-y divide-line">
            {ACTIVE_STAGES.map((s) => (
              <li key={s} className="flex items-center justify-between px-5 py-2 text-sm">
                <span>{s}</span>
                <span className="font-semibold">{stageCount.get(s) ?? 0}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-5 py-2 text-sm text-muted">
              <span>Deal Lost</span>
              <span>{stageCount.get("Deal Lost") ?? 0}</span>
            </li>
          </ul>
          <div className="border-t border-line px-5 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Newest contacts</h3>
            <ul className="space-y-1 text-sm">
              {recentContacts.map((c) => (
                <li key={c.id} className="truncate">
                  <Link href={`/contacts/${c.id}`} className="hover:underline">
                    {fullName(c)}
                  </Link>
                  {c.company && <span className="text-muted"> · {c.company.name}</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="card px-5 py-4 transition-colors hover:bg-cream-50">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{value.toLocaleString()}</div>
    </Link>
  );
}
