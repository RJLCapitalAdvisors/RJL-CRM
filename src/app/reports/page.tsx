import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CompanyLogo } from "@/components/company-logo";
import { REPORT_STAGES } from "@/lib/taxonomy";
import { AWAITING_RESPONSE, TRACKER_STATUSES } from "@/lib/tracker";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Progress reports" };

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/** Every deal that has a progress report, most in need of attention first. */
async function loadRows() {
  const deals = await prisma.deal.findMany({
    where: { stage: { in: [...REPORT_STAGES] }, investors: { some: {} } },
    include: { sponsorCompany: { select: { domain: true, name: true } }, investors: { select: { status: true, updatedAt: true } } },
  });

  const now = Date.now();
  const rows = deals
    .map((d) => {
      const counts = new Map<number, number>();
      for (const r of d.investors) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
      const awaiting = d.investors.filter((r) => AWAITING_RESPONSE.includes(r.status));
      const oldest = awaiting.reduce<number>((m, r) => Math.min(m, r.updatedAt.getTime()), now);
      const staleDays = awaiting.length ? Math.floor((now - oldest) / DAY) : 0;
      const lastUpdated = d.investors.reduce<Date>((m, r) => (r.updatedAt > m ? r.updatedAt : m), d.updatedAt);
      return { d, counts, awaiting: awaiting.length, staleDays, lastUpdated, responded: d.investors.filter((r) => r.status >= 4).length };
    })
    .sort((a, b) => b.staleDays - a.staleDays || b.awaiting - a.awaiting || b.lastUpdated.getTime() - a.lastUpdated.getTime());
  return rows;
}

export default async function ReportsPage() {
  const rows = await loadRows();
  return (
    <>
      <PageHeader title="Active progress reports" subtitle={`${rows.length} deals out to investors. Sorted by who has been waiting longest.`} />
      <div className="mx-8 my-6 flex h-[calc(100vh-150px)] min-h-[420px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="table dense w-full min-w-[900px]">
            <thead>
              <tr>
                <th className="w-[240px]">Deal</th>
                <th className="w-[130px]">Stage</th>
                <th className="w-[90px] text-center">Sent to</th>
                <th className="w-[110px] text-center">Awaiting</th>
                <th className="w-[110px] text-center">Responded</th>
                <th>Status mix</th>
                <th className="w-[120px]">Last update</th>
                <th className="w-[190px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, counts, awaiting, staleDays, lastUpdated, responded }) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/deals/${d.id}/tracker`} className="flex items-center gap-2 font-medium hover:underline">
                      <CompanyLogo domain={d.sponsorCompany?.domain} name={d.sponsorName ?? d.name} />
                      <span className="truncate">{d.propertyName ?? d.name}</span>
                    </Link>
                  </td>
                  <td className="truncate text-muted">{d.stage}</td>
                  <td className="text-center">{d.investors.length}</td>
                  <td className="text-center">
                    {awaiting ? (
                      <span className={`chip ${staleDays >= 5 ? "bg-ink text-white" : "bg-sky text-ink"}`} title="Deal Sent or Followed Up with no response">
                        {awaiting}
                        {staleDays >= 5 ? ` · ${staleDays}d` : ""}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-center">{responded || <span className="text-muted">—</span>}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {[...TRACKER_STATUSES].reverse().map((s) => {
                        const n = counts.get(s.id) ?? 0;
                        return n ? (
                          <span key={s.id} className="chip text-[10px]" style={{ background: s.bg, color: s.c }}>
                            {s.short} {n}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </td>
                  <td className="text-muted">{fmtDate(lastUpdated)}</td>
                  <td className="text-right">
                    <Link href={`/deals/${d.id}/tracker`} className="btn-secondary px-2 py-1 text-xs">
                      Open report
                    </Link>
                    {awaiting > 0 && (
                      <Link href={`/deals/${d.id}/tracker#followup`} className="btn-primary ml-1 px-2 py-1 text-xs">
                        Follow up {awaiting}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted">
                    No deals are out to investors yet. Send a deal and its progress report appears here.
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
