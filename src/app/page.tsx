import Link from "next/link";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { investorLabel } from "@/lib/tracker";
import { EXTRA_FIELD_LABELS, PROPOSAL_FIELDS, type Change } from "@/lib/criteria-proposals";
import { STALE_DAYS, staleDeals } from "@/lib/stale-deals";
import { possibleDuplicates } from "@/lib/deal-dedupe";
import { reportsDue, type ReportDue } from "@/lib/report-due";
import { approveProposal, dismissIntro, dismissMomentum, dismissProposal, openFollowUp, openIntroDraft, openMomentumDraft , dismissFollowUps , markDealLostAction, keepDealAction , mergeDealsAction, notDuplicateAction , handleStaleDeal , openReportDraftAction, markReportSentAction , markDealLostFromLaunchAction } from "./todo-actions";
import { DraftButton } from "./draft-button";
import { listMomentum } from "@/lib/momentum";
import { quietIntros, QUIET_INTRO_DAYS } from "@/lib/intros";
import { currentUser } from "@/lib/current-user";
import { kickMailSync } from "@/lib/mail-sync";
import { kickDashboardRefresh } from "@/lib/dashboard-refresh";
import { Item, ItemForm } from "./dash-item";
import { kickBlasts } from "@/lib/blasts";

export const metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
/** An LP gets this many calendar days to respond to a deal (or a follow-up) before they show up as quiet: sent Monday, quiet from Wednesday morning. */
const QUIET_AFTER_DAYS = 2;
/** The dashboard starts the clock here: anything that began before this date stays off (the old backlog lives on the report and deal pages). */
const HOME_SINCE = new Date("2026-08-31T00:00:00Z");
const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY);
const KIND: Record<string, string> = { LP_ASK: "LP request for the sponsor", ENGAGEMENT: "engagement letter unanswered", SPONSOR_ITEMS: "waiting on sponsor", INTRO: "intro not scheduled", ACTION: "open action item", MENTIONED: "mentioned, never sent" };

/** LPs who were sent a deal (or followed up with) and have said nothing for QUIET_AFTER_DAYS, grouped by deal. */
async function quietInvestors() {
  // calendar days in New York, not 48 hours: a deal sent Monday afternoon shows its quiet LPs Wednesday morning
  const now = new Date();
  const nyWall = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })); // New York wall clock, read as if it were UTC
  const offset = now.getTime() - nyWall.getTime() + (nyWall.getTime() - Date.UTC(nyWall.getFullYear(), nyWall.getMonth(), nyWall.getDate(), nyWall.getHours(), nyWall.getMinutes(), nyWall.getSeconds()));
  const nyMidnight = Date.UTC(nyWall.getFullYear(), nyWall.getMonth(), nyWall.getDate()) + offset; // the instant today began in New York
  const cutoff = new Date(nyMidnight - (QUIET_AFTER_DAYS - 1) * DAY);
  const rows = await prisma.dealInvestor.findMany({
    where: { status: { in: [2, 3] }, followUpDismissedAt: null, updatedAt: { lt: cutoff, gte: HOME_SINCE }, deal: { stage: { in: [...ACTIVE_STAGES] } } },
    include: { contact: { include: { company: { select: { name: true } } } }, deal: { select: { id: true, name: true, propertyName: true } } },
    orderBy: { updatedAt: "asc" },
  });
  const byDeal = new Map<string, { deal: (typeof rows)[number]["deal"]; rows: typeof rows }>();
  for (const r of rows) {
    const g = byDeal.get(r.dealId) ?? { deal: r.deal, rows: [] };
    g.rows.push(r);
    byDeal.set(r.dealId, g);
  }
  return [...byDeal.values()].sort((a, b) => a.rows[0].updatedAt.getTime() - b.rows[0].updatedAt.getTime());
}

/** One dashboard window: title band, count, scrolling body. Compact so five fit in a row. */
function Window({ title, count, children, empty }: { title: string; count: number; children: ReactNode; empty: string }) {
  return (
    <div className="card flex h-[calc(100vh-140px)] min-h-[420px] flex-col">
      <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-cream px-3 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted">{count}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto text-sm">{count === 0 ? <div className="px-3 py-8 text-center text-xs text-muted">{empty}</div> : children}</div>
    </div>
  );
}

export default async function Dashboard() {
  kickMailSync();
  kickBlasts();
  const me = await currentUser();
  // Microsoft is never asked during the render. What you just sent, drafts that went out and Handle emails that
  // went out are picked up after the page is served (throttled); the next load shows the result.
  kickDashboardRefresh(me?.email);
  const showCriteria = Boolean(me?.canEditCriteria);
  const [proposals, quiet, momentum, intros, readyDeals, stale, dupes, reports] = await Promise.all([
    showCriteria ? prisma.criteriaProposal.findMany({ where: { status: "PENDING", createdAt: { gte: HOME_SINCE } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    quietInvestors(),
    listMomentum(HOME_SINCE),
    quietIntros(),
    prisma.deal.findMany({ where: { stage: "Engagement Letter Signed" }, include: { owner: { select: { name: true } }, _count: { select: { investors: true } } }, orderBy: { updatedAt: "desc" } }),
    showCriteria ? staleDeals() : Promise.resolve([]),
    showCriteria ? possibleDuplicates() : Promise.resolve([]),
    reportsDue().catch(() => [] as ReportDue[]),
  ]);

  const companies = new Map((await prisma.company.findMany({ where: { id: { in: proposals.map((p) => p.companyId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const people = new Map((await prisma.contact.findMany({ where: { id: { in: proposals.map((p) => p.contactId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true } })).map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ")]));
  const today = new Date();
  const quietCount = quiet.reduce((n, g) => n + g.rows.length, 0);
  const cols = showCriteria ? "2xl:grid-cols-5" : "2xl:grid-cols-4";

  return (
    <>
      <PageHeader compact title="Dashboard" subtitle={`${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${quietCount} LP follow-ups · ${momentum.length} momentum · ${intros.length} intros to reconsider · ${readyDeals.length + reports.length} ready for launch${showCriteria ? ` · ${proposals.length + stale.length + dupes.length} data updates` : ""}`} />
      <div className={`grid gap-3 px-5 py-4 md:grid-cols-2 xl:grid-cols-3 ${cols}`}>
        <Window title="LP follow-ups" count={quietCount} empty={`Everyone you have sent a deal to has responded, or got it less than ${QUIET_AFTER_DAYS} days ago.`}>
          <ul className="divide-y divide-line">
            {quiet.map((g) => (
              <Item key={g.deal.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/deals/${g.deal.id}/tracker`} className="font-semibold hover:underline">
                    {g.deal.propertyName ?? g.deal.name}
                  </Link>
                  <ItemForm action={dismissFollowUps.bind(null, g.rows.map((r) => r.id))} className="text-[11px] text-muted hover:text-ink hover:underline" title="Take every quiet LP on this deal off the list (they stay on the progress report)">Dismiss all</ItemForm>
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {g.rows.map((r) => (
                    <Item key={r.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate">{r.contact.company?.name ?? investorLabel(r.contact)}</div>
                        <div className="truncate text-xs text-muted">
                          {days(r.updatedAt)}d{r.status === 3 ? " · followed up" : ""}
                          {r.followUpDraftId ? " · draft in Outlook" : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <ItemForm action={dismissFollowUps.bind(null, [r.id])} className="text-[11px] text-muted hover:text-ink" title="Take this LP off the list (they stay on the progress report)">✕</ItemForm>
                        <DraftButton label={r.followUpDraftId ? "Open" : "Handle"} action={openFollowUp.bind(null, r.id)} disabled={!r.contact.email || r.contact.unsubscribed} title="Reply-all to the deal email with the attachments, your signature" />
                      </div>
                    </Item>
                  ))}
                </ul>
              </Item>
            ))}
          </ul>
        </Window>

        <Window title="Deal momentum" count={momentum.length} empty="Nothing stalled: sponsors owing items, intros not getting scheduled, open call action items, deals mentioned but never sent.">
          <ul className="divide-y divide-line">
            {momentum.map((m) => (
              <Item key={m.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/deals/${m.dealId}`} className="font-semibold hover:underline">
                      {m.deal.propertyName ?? m.deal.name}
                    </Link>
                    <div className="truncate text-xs text-muted">
                      {m.party} · {days(m.waitingSince)}d · {KIND[m.kind] ?? m.kind}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-soft">{m.summary}</div>
                  </div>
                  <div className="act-col">
                    <DraftButton block action={openMomentumDraft.bind(null, m.id)} title="Reply on that thread in Outlook, blank, with your signature" />
                    <ItemForm action={dismissMomentum.bind(null, m.id)} className="btn-grey act">Dismiss</ItemForm>
                  </div>
                </div>
              </Item>
            ))}
          </ul>
        </Window>

        <Window title="Intros to reconsider" count={intros.length} empty={`Every intro any of you made has had activity in the last ${QUIET_INTRO_DAYS} days.`}>
          <ul className="divide-y divide-line">
            {intros.map((i) => (
              <Item key={i.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{i.partyA && i.partyB ? `${i.partyA} | ${i.partyB}` : i.subject.replace(/^\s*intro\b\s*[-:–—]?\s*/i, "")}</div>
                    <div className="truncate text-xs text-muted">
                      {i.introducedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} by {i.mailbox.split("@")[0]} · quiet {days(i.lastActivityAt)}d · {i.replies} repl{i.replies === 1 ? "y" : "ies"}
                      {i.handledAt && <span className="text-sky-700"> · handled {i.handledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}, drops off when your reply is sent</span>}
                    </div>
                  </div>
                  <div className="act-col">
                    <DraftButton block action={openIntroDraft.bind(null, i.id)} title="Reply-all on the intro thread, blank, with your signature" />
                    <ItemForm action={dismissIntro.bind(null, i.id)} className="btn-grey act">Dismiss</ItemForm>
                  </div>
                </div>
              </Item>
            ))}
          </ul>
        </Window>

        <Window title="Ready for launch" count={readyDeals.length + reports.length} empty="A deal shows up here the moment its engagement letter is marked signed, and a live deal whose progress report changed shows up when its report is due (every other day, and Thursdays at 4:30).">
          {reports.length > 0 && (
            <div className="border-b border-line bg-cream-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Progress reports due ({reports.length}) · every other day and Thursdays 4:30, only when the report changed
            </div>
          )}
          <ul className="divide-y divide-line">
            {reports.map((r) => (
              <Item key={`report-${r.id}`} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/deals/${r.id}/tracker`} className="font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {r.sponsorName ?? "Sponsor"} · {r.changedSince} of {r.groups} groups changed · {r.reason}
                      {r.lastSentAt ? ` · last sent ${r.lastSentAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                    </div>
                  </div>
                  <div className="act-col">
                    <DraftButton block label="Handle" action={openReportDraftAction.bind(null, r.id)} title="Reply all on your latest exchange with the sponsor, the fresh progress report attached" />
                    <ItemForm action={markReportSentAction.bind(null, r.id)} className="btn-grey act" title="You already sent it another way; restart the clock">Sent already</ItemForm>
                    <ItemForm action={markDealLostFromLaunchAction.bind(null, r.id)} className="act-lost" title="Clears the deal from the pipeline and the dashboard (intros to reconsider stay)">Mark as deal lost</ItemForm>
                  </div>
                </div>
              </Item>
            ))}
          </ul>
          {readyDeals.length > 0 && reports.length > 0 && <div className="border-b border-t border-line bg-cream-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Engagement letter signed, ready to send</div>}
          <ul className="divide-y divide-line">
            {readyDeals.map((d) => (
              <Item key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/deals/${d.id}`} className="font-semibold hover:underline">
                    {d.propertyName ?? d.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    {d.sponsorName ?? "Sponsor"} · {d._count.investors} groups{d.owner ? ` · ${d.owner.name}` : ""}
                  </div>
                </div>
                <div className="act-col">
                  <Link href={`/deals/${d.id}/send`} className="btn-soft act">
                    Send deal
                  </Link>
                  <ItemForm action={markDealLostFromLaunchAction.bind(null, d.id)} className="act-lost" title="Clears the deal from the pipeline and the dashboard (intros to reconsider stay)">Mark as deal lost</ItemForm>
                </div>
              </Item>
            ))}
          </ul>
        </Window>

        {showCriteria && (
          <Window title="Data updates" count={proposals.length + stale.length + dupes.length} empty="Nothing to approve. Criteria corrections from investor emails, notes, calls or teammates, people who left their firm, and deals that went quiet land here.">
            {dupes.length > 0 && (
              <div className="border-b border-line bg-cream-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Possible duplicates ({dupes.length}) · one deal, one ticket
              </div>
            )}
            <ul className="divide-y divide-line">
              {dupes.map((d) => (
                <Item key={`${d.a.id}-${d.b.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted">{d.why}</div>
                    <div className="mt-0.5">
                      <Link href={`/deals/${d.a.id}`} className="font-semibold hover:underline">
                        {d.a.name}
                      </Link>
                      <span className="text-xs text-muted"> · {[d.a.sponsorName, d.a.stage, d.a.propertyAddress].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="mt-0.5">
                      <Link href={`/deals/${d.b.id}`} className="font-semibold hover:underline">
                        {d.b.name}
                      </Link>
                      <span className="text-xs text-muted"> · {[d.b.sponsorName, d.b.stage, d.b.propertyAddress].filter(Boolean).join(" · ")}</span>
                    </div>
                  </div>
                  <div className="act-col">
                    <ItemForm action={mergeDealsAction.bind(null, d.b.id, d.a.id)} className="btn-soft act" title={`Fold "${d.b.name}" into "${d.a.name}" (the ticket with more on it); emails, files, report rows and notes all move over`}>Merge into first</ItemForm>
                    <ItemForm action={notDuplicateAction.bind(null, d.a.id, d.b.id)} className="btn-grey act">Not the same</ItemForm>
                  </div>
                </Item>
              ))}
            </ul>
            {stale.length > 0 && (
              <div className="border-b border-line bg-cream-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Deals gone quiet ({stale.length}) · nothing for {STALE_DAYS}+ days, Deal Mentioned through Intro To Capital Made
              </div>
            )}
            <ul className="divide-y divide-line">
              {stale.map((d) => (
                <Item key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/deals/${d.id}`} className="font-semibold hover:underline">
                      {d.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {[`quiet ${d.quietDays}d`, d.sponsorName, d.stage, d.investors ? `${d.investors} on the report` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="act-col">
                    <DraftButton block label="Handle" action={handleStaleDeal.bind(null, d.id)} title="Open a check-in email on the thread this deal came through" />
                    <ItemForm action={keepDealAction.bind(null, d.id)} className="btn-grey act" title={`Still alive; ask me again in ${STALE_DAYS} quiet days`}>Keep</ItemForm>
                    <ItemForm action={markDealLostAction.bind(null, d.id)} className="act-lost" title="Move to Deal Lost; it leaves Deal momentum and LP follow-ups">Mark as deal lost</ItemForm>
                  </div>
                </Item>
              ))}
              {proposals.map((p) => {
                const changes = JSON.parse(p.changes) as Change[];
                return (
                  <Item key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={p.contactId && changes.some((c) => c.field === "removeContact") ? `/contacts/${p.contactId}` : `/companies/${p.companyId}`} className="font-semibold hover:underline">
                        {changes.some((c) => c.field === "removeContact") && p.contactId ? `${people.get(p.contactId) || "Contact"}${p.companyId && companies.get(p.companyId) ? ` · ${companies.get(p.companyId)}` : ""}` : (p.companyId && companies.get(p.companyId)) ?? "Investor"}
                      </Link>
                      <span className="shrink-0 text-[11px] text-muted">{p.source === "NOTE" ? "note" : p.source === "EMAIL" ? "email" : p.source === "FIREFLIES" ? "call" : p.sourceRef ?? "teammate"}</span>
                    </div>
                    <ul className="mt-1 space-y-1">
                      {changes.map((c) => (
                        <Item key={c.field} className="text-xs">
                          <span className="text-muted">{c.field === "removeContact" ? EXTRA_FIELD_LABELS.removeContact : PROPOSAL_FIELDS[c.field]?.label ?? c.field}:</span> <span className="line-through text-muted">{c.from || "blank"}</span> <span className="font-medium">{c.to}</span>
                          {c.evidence && <div className="italic text-muted">“{c.evidence}”</div>}
                        </Item>
                      ))}
                    </ul>
                    </div>
                    <div className="act-col">
                      <ItemForm action={approveProposal.bind(null, p.id)} className="btn-soft act">Approve</ItemForm>
                      <ItemForm action={dismissProposal.bind(null, p.id)} className="btn-grey act">Dismiss</ItemForm>
                    </div>
                  </Item>
                );
              })}
            </ul>
          </Window>
        )}
      </div>
    </>
  );
}
