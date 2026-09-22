import Link from "next/link";
import { RefreshButton } from "./refresh-button";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { AttachmentList } from "@/components/attachment-list";
import { progressReportFileName } from "@/lib/progress-report-pdf";
import { ReportView } from "@/components/report-view";
import { AWAITING_RESPONSE, TRACKER_STATUSES_BY_RANK, fmtReportDate, investorLabel, statusOf } from "@/lib/tracker";
import { GrowingTextarea } from "@/components/growing-textarea";
import { DraftButton } from "@/app/draft-button";
import { openReportDraftAction } from "@/app/todo-actions";
import { AutoSaveForm } from "@/components/autosave-form";
import { str } from "@/lib/format";
import { loadReport } from "@/lib/tracker-report";
import { syncSendDrafts } from "@/lib/send-deal";
import { signContactToken, signFileToken } from "@/lib/tokens";
import { missingFor, itemLabel } from "@/lib/checklist";
import { forgetRemovalAction, removeTrackerRow, saveTrackerMeta, undoRemovalAction } from "./actions";
import { NoteCell, StatusBadge } from "./tracker-row";
import { TrackerContactPicker } from "./contact-picker";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `${d ? d.propertyName ?? d.name : "Deal"} Progress Report` };
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Refresh report reads every mailbox and re-reads the replies

export default async function TrackerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  await syncSendDrafts().catch(() => 0); // a deal email sent from Outlook (Send deal, Send to one person) shows as Deal Sent here right away
  const sp = await searchParams;
  const statusFilter = Number(str(sp.status)) || 0;
  const report = await loadReport(id);
  const removals = await prisma.trackerRemoval.findMany({ where: { dealId: id, removedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { removedAt: "desc" } }).catch(() => []);
  const removedContacts = removals.length ? new Map((await prisma.contact.findMany({ where: { id: { in: removals.map((r) => r.contactId) } }, select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } } })).map((c) => [c.id, c])) : new Map();
  if (!report) notFound();
  const { deal, name, lastUpdated } = report;
  const awaiting = deal.investors.filter((r) => AWAITING_RESPONSE.includes(r.status) && r.contact.email && !r.contact.unsubscribed).length;
  const shareUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/share/tracker/${signContactToken(deal.id)}`;
  const pdfUrl = `/api/deals/${deal.id}/progress-report.pdf?t=${signFileToken(`report:${deal.id}`)}`;
  const checklistGaps = missingFor(deal).map((it) => itemLabel(it, deal.strategy));
  const counts = new Map<number, number>();
  for (const r of deal.investors) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const shown = statusFilter ? { ...report, rows: report.rows.filter((r) => r.status === statusFilter) } : report;

  return (
    <>
      <PageHeader
        title={`${name} â€” Progress Report`}
        subtitle={`${deal.investors.length} investors Â· ${awaiting} awaiting response Â· last updated ${fmtReportDate(lastUpdated)}`}
        actions={
          <>
            <RefreshButton dealId={deal.id} />
            <Link href={`/deals/${deal.id}`} className="btn-secondary">
              Back to deal
            </Link>
            <a href={shareUrl} target="_blank" className="btn-secondary" title="What the sponsor sees. Print from there to save a PDF.">
              Sponsor view / PDF
            </a>
            <DraftButton label="Send to sponsor" action={openReportDraftAction.bind(null, deal.id)} title="Reply all on your latest exchange with the sponsor, today's progress report attached" />
          </>
        }
      />

      {removals.length > 0 && (
        <div className="mx-8 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-medium">Removed from this report:</span>
          {removals.map((r) => {
            const c = removedContacts.get(r.contactId);
            return (
              <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2 py-0.5">
                {c ? investorLabel(c) : "a row"} · {statusOf(r.status).short}
                {r.removedBy ? ` · by ${r.removedBy}` : ""}
                <form action={undoRemovalAction.bind(null, r.id)} className="inline">
                  <button type="submit" className="font-semibold text-sky-700 hover:underline">
                    Undo
                  </button>
                </form>
                <form action={forgetRemovalAction.bind(null, r.id)} className="inline">
                  <button type="submit" className="text-muted hover:text-ink" title="Forget this removal">
                    ×
                  </button>
                </form>
              </span>
            );
          })}
        </div>
      )}
      <div className="mx-8 mb-3 flex flex-wrap items-center gap-3">
        <TrackerContactPicker dealId={deal.id} />
        <div className="flex items-center rounded-md border border-line bg-paper" title="Drag this file straight into an Outlook email, or click to download">
          <AttachmentList files={[{ id: "report-pdf", kind: "faq", name: progressReportFileName(name), size: 0, date: "", url: pdfUrl }]} />
          <a href={pdfUrl} download className="btn-soft mr-1 px-2.5 py-1 text-xs" title="Download the PDF">
            Download PDF
          </a>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Show</span>
          <Link href={`/deals/${deal.id}/tracker`} className={`rounded-full border px-2.5 py-0.5 ${statusFilter === 0 ? "border-ink bg-ink text-white" : "border-line text-muted hover:bg-cream"}`}>
            All ({deal.investors.length})
          </Link>
          {TRACKER_STATUSES_BY_RANK.map((s) => {
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
                    <GrowingTextarea name="trackerThemes" defaultValue={deal.trackerThemes} minRows={3} bullets className="mt-1 text-[10.5pt]" placeholder="One theme per line. Written from the notes on its own; type here to change it." />
                  </div>
                  <div>
                    <div className="text-[13pt] font-bold">Items Needed from Sponsor</div>
                    <GrowingTextarea name="trackerItemsNote" defaultValue={deal.trackerItemsNote} minRows={3} bullets className="mt-1 text-[10.5pt]" placeholder="One item per line." />
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
                  Ã—
                </button>
              </form>
            ),
          }}
        />
      </div>
    </>
  );
}
