import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ReportView } from "@/components/report-view";
import { AWAITING_RESPONSE, TRACKER_STATUSES, fmtReportDate } from "@/lib/tracker";
import { AutoSaveForm } from "@/components/autosave-form";
import { str } from "@/lib/format";
import { loadReport } from "@/lib/tracker-report";
import { signContactToken } from "@/lib/tokens";
import { missingFor, itemLabel } from "@/lib/checklist";
import { createFollowUpCampaign, regenerateTrackerSummary, removeTrackerRow, saveTrackerMeta } from "./actions";
import { NoteCell, StatusBadge } from "./tracker-row";
import { TrackerContactPicker } from "./contact-picker";
import { CopyLink } from "./copy-link";

export const dynamic = "force-dynamic";

export default async function TrackerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const statusFilter = Number(str(sp.status)) || 0;
  const [report, followUpTemplates] = await Promise.all([
    loadReport(id),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", name: { contains: "Follow-up" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!report) notFound();
  const { deal, name, lastUpdated } = report;
  const awaiting = deal.investors.filter((r) => AWAITING_RESPONSE.includes(r.status) && r.contact.email && !r.contact.unsubscribed).length;
  const shareUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/share/tracker/${signContactToken(deal.id)}`;
  const checklistGaps = missingFor(deal).map((it) => itemLabel(it, deal.strategy));
  const counts = new Map<number, number>();
  for (const r of deal.investors) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const shown = statusFilter ? { ...report, rows: report.rows.filter((r) => r.status === statusFilter) } : report;

  return (
    <>
      <PageHeader
        title={`${name} — Progress Report`}
        subtitle={`${deal.investors.length} investors · ${awaiting} awaiting response · last updated ${fmtReportDate(lastUpdated)}`}
        actions={
          <>
            <Link href={`/deals/${deal.id}`} className="btn-secondary">
              Back to deal
            </Link>
            <CopyLink url={shareUrl} />
            <a href={shareUrl} target="_blank" className="btn-secondary" title="What the sponsor sees. Print from there to save a PDF.">
              Sponsor view / PDF
            </a>
            <form id="followup" action={createFollowUpCampaign.bind(null, deal.id)} className="flex items-center gap-1">
              {followUpTemplates.length > 1 && (
                <select name="templateId" className="input w-56 text-xs" defaultValue={followUpTemplates[0]?.id}>
                  {followUpTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn-primary" type="submit" disabled={awaiting === 0} title={awaiting === 0 ? "Nobody is waiting on a response" : "One-at-a-time follow-up queue for everyone in Deal Sent / Followed Up"}>
                Follow up with {awaiting} not responded
              </button>
            </form>
          </>
        }
      />

      <div className="mx-8 mb-3 flex flex-wrap items-center gap-3">
        <TrackerContactPicker dealId={deal.id} />
        <form action={regenerateTrackerSummary.bind(null, deal.id)}>
          <button className="btn-secondary" type="submit" title="Rewrites the feedback themes and items needed from the notes below. Also happens on its own whenever you save a note.">
            Rewrite from notes
          </button>
        </form>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Show</span>
          <Link href={`/deals/${deal.id}/tracker`} className={`rounded-full border px-2.5 py-0.5 ${statusFilter === 0 ? "border-ink bg-ink text-white" : "border-line text-muted hover:bg-cream"}`}>
            All ({deal.investors.length})
          </Link>
          {[...TRACKER_STATUSES].reverse().map((s) => {
            const n = counts.get(s.id) ?? 0;
            if (!n) return null;
            const active = statusFilter === s.id;
            return (
              <Link key={s.id} href={`/deals/${deal.id}/tracker?status=${s.id}`} className="rounded-full border px-2.5 py-0.5" style={active ? { background: s.bg, color: s.c, borderColor: s.c } : { borderColor: "#dfe6ee", color: "#6b716e" }}>
                {s.short} ({n})
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mx-8 mb-8 border border-line bg-white shadow-sm">
        <ReportView
          report={shown}
          slots={{
            showPeople: false,
            headerEditor: (
              <AutoSaveForm action={saveTrackerMeta.bind(null, deal.id)} className="my-3">
                <div className="grid gap-3 md:grid-cols-2" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                  <div>
                    <div className="text-[13pt] font-bold">Notable Feedback Themes</div>
                    <textarea name="trackerThemes" rows={5} defaultValue={deal.trackerThemes ?? ""} className="input mt-1 text-[10.5pt]" placeholder="One theme per line. Rewritten from the notes automatically; edit freely." />
                  </div>
                  <div>
                    <div className="text-[13pt] font-bold">Items Needed from Sponsor</div>
                    <textarea name="trackerItemsNote" rows={5} defaultValue={deal.trackerItemsNote ?? ""} className="input mt-1 text-[10.5pt]" placeholder="One item per line." />
                    {checklistGaps.length > 0 && <div className="mt-1 text-[9pt] text-muted">Still blank on the ticket: {checklistGaps.join(", ")}</div>}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10pt]">
                  <span className="font-bold">Prepared For:</span>
                  <input name="trackerPreparedFor" defaultValue={deal.trackerPreparedFor ?? ""} className="input max-w-xs py-1 text-[10pt]" placeholder={deal.sponsorName ?? "Sponsor contact"} />
                </div>
              </AutoSaveForm>
            ),
            statusCell: (r) => <StatusBadge rowId={r.id} status={r.status} />,
            noteCell: (r) => <NoteCell rowId={r.id} note={r.note} />,
            rowEnd: (r) => (
              <form action={removeTrackerRow.bind(null, r.id)}>
                <button type="submit" className="hover:text-red-700" title="Remove from report">
                  ×
                </button>
              </form>
            ),
          }}
        />
      </div>
    </>
  );
}
