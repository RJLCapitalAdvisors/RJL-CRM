import Link from "next/link";
import { ZoomBox } from "@/components/zoom-box";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CompanyLogo } from "@/components/company-logo";
import { REPORT_STAGES } from "@/lib/taxonomy";
import { AWAITING_RESPONSE, TRACKER_STATUSES_BY_RANK } from "@/lib/tracker";
import { fmtDate } from "@/lib/format";
import { reportActive, reportQualifies } from "@/lib/report-active";
import { Item, ItemForm } from "@/app/dash-item";
import { markReportInactive } from "./actions";

export const metadata = { title: "Progress reports" };

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/** Every deal with a live progress report (full investor list out, not an intro, not marked Not active), most in need of attention first. */
async function loadRows() {
  const deals = await prisma.deal.findMany({
    where: { stage: { in: [...REPORT_STAGES] }, investors: { some: {} } },
    include: { sponsorCompany: { select: { domain: true, name: true } }, investors: { select: { status: true, updatedAt: true } } },
  });

  const now = Date.now();
  const rows = deals
    .filter((d) => reportQualifies(d.name, d.investors) && reportActive(d.reportInactiveAt, d.investors))
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
      <PageHeader title="Active progress reports" subtitle={`${rows.length} deals out to their investor lists. Sorted by who has been waiting longest. Not active takes a report off this page until the deal moves again.`} />
      <div className="mx-8 mt-3 flex items-center gap-3"><div id="zoom-tools" className="ml-auto" /></div>
      <div className="mx-8 mb-6 mt-2 flex h-[calc(100vh-136px)] min-h-[420px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <ZoomBox id="reports"><table className="table dense w-full min-w-[900px]">
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
                <Item key={d.id} as="tr">
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
                      {TRACKER_STATUSES_BY_RANK.map((s) => {
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
                    <ItemForm action={markReportInactive.bind(null, d.id)} className="btn-grey ml-1 px-2 py-1 text-xs" title="Takes this report off the page until an investor on the deal responds or is written to again">
                      Not active
                    </ItemForm>
                  </td>
                </Item>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted">
                    Nothing here. A deal shows once its full investor list is out (five or more groups sent; intros never count) and until it is marked Not active.
                  </td>
                </tr>
              )}
            </tbody>
          </table></ZoomBox>
        </div>
      </div>
    </>
  );
}
