import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { AWAITING_RESPONSE, TRACKER_STATUSES, fmtReportDate, investorLabel } from "@/lib/tracker";
import { loadReport } from "@/lib/tracker-report";
import { signContactToken } from "@/lib/tokens";
import { str } from "@/lib/format";
import { addDealAction, createFollowUpCampaign, deleteDealAction, removeTrackerRow, saveTrackerMeta, toggleDealAction } from "./actions";
import { NoteCell, StatusBadge } from "./tracker-row";
import { TrackerContactPicker } from "./contact-picker";
import { CopyLink } from "./copy-link";

export const dynamic = "force-dynamic";

export default async function TrackerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sortPriority = Number(str(sp.sort)) || 0;
  const [report, followUpTemplates, campaigns] = await Promise.all([
    loadReport(id),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", name: { contains: "Follow-up" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.campaign.findMany({ where: { dealId: id }, orderBy: { createdAt: "desc" }, select: { id: true, followUp: true, createdAt: true, recipients: { select: { status: true } } } }),
  ]);
  if (!report) notFound();
  const { deal, name, lastUpdated, itemsNeeded, chips } = report;

  const rows = [...report.rows].sort((a, b) => {
    if (sortPriority) {
      const ap = a.status === sortPriority ? 1 : 0;
      const bp = b.status === sortPriority ? 1 : 0;
      if (ap !== bp) return bp - ap;
    }
    return b.status - a.status || investorLabel(a.contact).localeCompare(investorLabel(b.contact));
  });
  const counts = new Map<number, number>();
  for (const r of deal.investors) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const awaiting = deal.investors.filter((r) => AWAITING_RESPONSE.includes(r.status) && r.contact.email && !r.contact.unsubscribed).length;
  const openActions = deal.actions.filter((a) => !a.done).length;
  const shareUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/share/tracker/${signContactToken(deal.id)}`;
  const saveMeta = saveTrackerMeta.bind(null, deal.id);

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
            <a href={shareUrl} target="_blank" className="btn-secondary" title="Sponsor view: read-only, with a Download PDF button">
              Sponsor view / PDF
            </a>
            <a href={`/deals/${deal.id}/tracker/export`} className="btn-secondary" title="Standalone HTML file in the old Google Drive format">
              Export HTML
            </a>
            <form action={createFollowUpCampaign.bind(null, deal.id)} className="flex items-center gap-1">
              {followUpTemplates.length > 1 && (
                <select name="templateId" className="input w-56 text-xs" defaultValue={followUpTemplates[0]?.id}>
                  {followUpTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn-primary" type="submit" disabled={awaiting === 0} title={awaiting === 0 ? "Nobody is waiting on a response" : "Creates a one-at-a-time follow-up queue for everyone in Deal Sent / Followed Up"}>
                Follow up with {awaiting} not responded
              </button>
            </form>
          </>
        }
      />

      <div className="mx-8 my-6 overflow-hidden rounded-xl border border-line bg-paper shadow-sm">
        <div className="bg-[#111827] px-8 pb-6 pt-7 text-white">
          <div className="mb-4 flex items-center justify-between">
            <div className="rounded-md bg-white px-3 py-1.5">
              <img src="/logo.png" alt="RJL Capital Advisors" className="h-7" />
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-[0.15em] text-[#60A5FA]">Last updated</div>
              <div className="text-xs text-white/60">{lastUpdated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            </div>
          </div>
          <div className="text-xl font-semibold">{name} — Progress Report</div>
          <div className="mt-1 mb-4 text-xs text-white/60">
            {deal.propertyAddress ? `Deal address: ${[deal.propertyAddress, deal.city, deal.state].filter(Boolean).join(", ")}` : "Deal address: not set"}
            {" · "}Prepared for: {deal.trackerPreparedFor ?? "not set"}
          </div>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <div key={c.label} className="rounded-md border border-[#60A5FA]/30 bg-white/5 px-3.5 py-1.5">
                <div className="text-[8.5px] uppercase tracking-[0.12em] text-[#60A5FA]">{c.label}</div>
                <div className="text-xs text-white/70">{c.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="h-0.5 bg-[#60A5FA]" />

        {/* Header fields, themes, items needed */}
        <form action={saveMeta} className="grid gap-4 border-b border-line p-5 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="trackerPreparedFor">
              Prepared for
            </label>
            <input id="trackerPreparedFor" name="trackerPreparedFor" defaultValue={deal.trackerPreparedFor ?? ""} className="input" placeholder={deal.sponsorName ? `${deal.sponsorName} team` : "Sponsor contact"} />
            <div className="mt-3 label">Items needed from sponsor</div>
            <div className="rounded-md border border-line bg-cream-50 px-3 py-2 text-xs">
              {itemsNeeded.length ? (
                <ol className="list-decimal space-y-0.5 pl-4">
                  {itemsNeeded.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ol>
              ) : (
                <span className="italic text-muted">Checklist complete.</span>
              )}
              <div className="mt-1 text-[10px] text-muted">From the deal ticket checklist. Add extra items below, one per line.</div>
            </div>
            <textarea name="trackerItemsNote" rows={2} defaultValue={deal.trackerItemsNote ?? ""} className="input mt-1 text-xs" placeholder="Updated rent roll as of September…" />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="trackerThemes">
              Notable feedback themes
            </label>
            <textarea id="trackerThemes" name="trackerThemes" rows={7} defaultValue={deal.trackerThemes ?? ""} className="input" placeholder={'Recurring objections, common themes, standout positives. E.g. "Returns cited as light by 3+ LPs", "Midwest outside focus for Sunbelt funds", "Hold period flagged as too long."'} />
            <div className="mt-2 flex justify-end">
              <button className="btn-primary" type="submit">
                Save report header
              </button>
            </div>
          </div>
        </form>

        {/* Action items */}
        <div className="m-5 overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between bg-[#111827] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">Action items</span>
              {openActions > 0 && <span className="rounded-full bg-[#60A5FA] px-2 text-[10px] font-semibold text-[#111827]">{openActions} open</span>}
            </div>
            <span className="text-[10px] text-white/40">internal, not shown to sponsors</span>
          </div>
          <ul>
            {deal.actions.map((a) => (
              <li key={a.id} className="flex items-start gap-3 border-b border-line px-4 py-2.5 text-sm">
                <form action={toggleDealAction.bind(null, a.id)}>
                  <button type="submit" className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border text-[10px] ${a.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-line"}`} aria-label="toggle">
                    {a.done ? "✓" : ""}
                  </button>
                </form>
                <span className={`flex-1 ${a.done ? "line-through text-muted" : ""}`}>{a.text}</span>
                <form action={deleteDealAction.bind(null, a.id)}>
                  <button type="submit" className="text-muted hover:text-red-700" title="Remove">
                    ×
                  </button>
                </form>
              </li>
            ))}
            <li className="px-4 py-2.5">
              <form action={addDealAction.bind(null, deal.id)} className="flex gap-2">
                <input name="text" placeholder="Add an action item…" className="input text-sm" />
                <button className="btn-secondary" type="submit">
                  Add
                </button>
              </form>
            </li>
          </ul>
        </div>

        {/* Sort bar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-cream-50 px-5 py-2.5">
          <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">Sort</span>
          <Link href={`/deals/${deal.id}/tracker`} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${sortPriority === 0 ? "border-ink bg-ink text-cream" : "border-line text-muted"}`}>
            Default (8→1)
          </Link>
          {[...TRACKER_STATUSES].reverse().map((s) => {
            const n = counts.get(s.id) ?? 0;
            if (!n) return null;
            const active = sortPriority === s.id;
            return (
              <Link key={s.id} href={`/deals/${deal.id}/tracker?sort=${s.id}`} className="rounded-full border px-2.5 py-0.5 text-[11px]" style={active ? { borderColor: s.d, background: s.bg, color: s.id === 6 ? "#1e40af" : s.c } : { borderColor: "#e6e2d3", color: "#6b716e" }}>
                {s.short} ({n})
              </Link>
            );
          })}
          <div className="ml-auto">
            <TrackerContactPicker dealId={deal.id} />
          </div>
        </div>

        {/* Rows */}
        <div className="grid grid-cols-[220px_230px_1fr_28px] bg-[#111827] px-5 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">
          <div>Investor</div>
          <div>Status</div>
          <div>Notes</div>
          <div />
        </div>
        {rows.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-muted">
            No investors on this tracker yet. Send the deal (the investors you email land here as &ldquo;Deal Sent&rdquo;), or add someone with the box above.
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.id} className={`grid grid-cols-[220px_230px_1fr_28px] items-start border-b border-line px-5 py-3 ${i % 2 ? "bg-cream-50/50" : ""}`}>
            <div className="pt-1 text-[13.5px] font-medium">
              <Link href={`/contacts/${r.contactId}`} className="hover:underline">
                {investorLabel(r.contact)}
              </Link>
              {r.contact.email && <div className="text-[11px] text-muted">{r.contact.email}</div>}
            </div>
            <div>
              <StatusBadge rowId={r.id} status={r.status} />
            </div>
            <div className="pr-4">
              <NoteCell rowId={r.id} note={r.note} noteDate={r.noteDate ? fmtReportDate(r.noteDate) : null} />
            </div>
            <form action={removeTrackerRow.bind(null, r.id)}>
              <button type="submit" className="text-muted hover:text-red-700" title="Remove from tracker">
                ×
              </button>
            </form>
          </div>
        ))}
        <div className="h-0.5 bg-[#60A5FA]" />
        <div className="flex items-center justify-between bg-[#111827] px-8 py-3 text-[10px] text-white/25">
          <span>RJL Capital Advisors · 9 Park Place, 3rd Floor, Great Neck, NY 11021 · 516.220.0477</span>
          <span className="italic">Confidential — For Authorized Recipients Only</span>
        </div>
      </div>

      {campaigns.length > 0 && (
        <div className="mx-8 mb-8 text-xs text-muted">
          Outreach rounds:{" "}
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="mr-3 underline">
              {c.followUp ? "Follow-up" : "Initial"} {fmtReportDate(c.createdAt)} · {c.recipients.filter((x) => x.status === "SENT").length}/{c.recipients.length} sent
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
