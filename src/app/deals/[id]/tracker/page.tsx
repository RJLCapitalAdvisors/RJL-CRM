import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ReportView } from "@/components/report-view";
import { AWAITING_RESPONSE, fmtReportDate } from "@/lib/tracker";
import { loadReport } from "@/lib/tracker-report";
import { signContactToken } from "@/lib/tokens";
import { missingFor, itemLabel } from "@/lib/checklist";
import { createFollowUpCampaign, regenerateTrackerSummary, removeTrackerRow, saveTrackerMeta } from "./actions";
import { NoteCell, StatusBadge } from "./tracker-row";
import { TrackerContactPicker } from "./contact-picker";
import { CopyLink } from "./copy-link";

export const dynamic = "force-dynamic";

export default async function TrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [report, followUpTemplates] = await Promise.all([
    loadReport(id),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", name: { contains: "Follow-up" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!report) notFound();
  const { deal, name, lastUpdated } = report;
  const awaiting = deal.investors.filter((r) => AWAITING_RESPONSE.includes(r.status) && r.contact.email && !r.contact.unsubscribed).length;
  const shareUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/share/tracker/${signContactToken(deal.id)}`;
  const checklistGaps = missingFor(deal).map((it) => itemLabel(it, deal.strategy));

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
          <button className="btn-secondary" type="submit" title="Rewrites Notable Feedback Themes and Items Needed from Sponsor from the notes below. Also happens on its own whenever you save a note.">
            Rewrite themes &amp; items from notes
          </button>
        </form>
        <details className="text-sm">
          <summary className="cursor-pointer text-sky-600 hover:underline">Edit by hand: prepared for, themes, items needed</summary>
          <form action={saveTrackerMeta.bind(null, deal.id)} className="card mt-2 grid w-[720px] max-w-full gap-3 p-4">
            <div>
              <label className="label" htmlFor="trackerPreparedFor">
                Prepared for
              </label>
              <input id="trackerPreparedFor" name="trackerPreparedFor" defaultValue={deal.trackerPreparedFor ?? ""} className="input" placeholder={deal.sponsorName ?? "Sponsor"} />
            </div>
            <div>
              <label className="label" htmlFor="trackerThemes">
                Notable feedback themes (one per line)
              </label>
              <textarea id="trackerThemes" name="trackerThemes" rows={4} defaultValue={deal.trackerThemes ?? ""} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="trackerItemsNote">
                Items needed from sponsor (one per line)
              </label>
              <textarea id="trackerItemsNote" name="trackerItemsNote" rows={3} defaultValue={deal.trackerItemsNote ?? ""} className="input" />
              {checklistGaps.length > 0 && <div className="mt-1 text-xs text-muted">Still missing on the deal ticket: {checklistGaps.join(", ")}</div>}
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" type="submit">
                Save
              </button>
            </div>
          </form>
        </details>
      </div>

      <div className="mx-8 mb-8 border border-line bg-white shadow-sm">
        <ReportView
          report={report}
          slots={{
            showPeople: true,
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
