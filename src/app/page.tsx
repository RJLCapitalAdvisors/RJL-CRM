import Link from "next/link";
import { checkLabel } from "@/lib/ranges";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { investorLabel } from "@/lib/tracker";
import { EXTRA_FIELD_LABELS, PROPOSAL_FIELDS, type Change, type ProposalField } from "@/lib/criteria-proposals";
import { STALE_DAYS, staleDeals } from "@/lib/stale-deals";
import { possibleDuplicates } from "@/lib/deal-dedupe";
import { reportsDue, type ReportDue } from "@/lib/report-due";
import { dismissTodoAction, approveProposal, approveProposals, dismissProposals, dismissIntro, dismissMomentum, dismissProposal, openFollowUp, openIntroDraft, openMomentumDraft , dismissFollowUps , markDealLostAction, keepDealAction , mergeDealsAction, notDuplicateAction , handleStaleDeal , openReportDraftAction, markReportSentAction , markDealLostFromLaunchAction } from "./todo-actions";
import { DraftButton } from "./draft-button";
import { listMomentum, momentumLines } from "@/lib/momentum";
import { introTitle, quietIntros, QUIET_INTRO_DAYS } from "@/lib/intros";
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
const KIND: Record<string, string> = { SPONSOR_ANSWER: "sponsor answered, pass it to the LP", LP_ASK: "LP request for the sponsor", ENGAGEMENT: "engagement letter unanswered", SPONSOR_ITEMS: "waiting on sponsor", INTRO: "intro not scheduled", ACTION: "open action item", MENTIONED: "mentioned, never sent" };

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
    include: { contact: { include: { company: { select: { id: true, name: true, contacts: { where: { email: { not: null }, unsubscribed: false, departedAt: null }, select: { id: true }, take: 1 } } } } }, deal: { select: { id: true, name: true, propertyName: true } } },
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

/** A Data updates button for a teammate who is not Jonathan: greyed, with the reason on hover. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <button type="button" disabled className="btn-grey act cursor-not-allowed opacity-50" title="Only Jonathan can approve this. If it has been sitting here, remind him.">
      {children}
    </button>
  );
}

/** A proposed check size is stored as buckets; on screen it is the range they cover ("$8MM to $20MM"). Everything else shows as written. */
function showProposalValue(field: string, v: unknown): string {
  const text = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
  if (field !== "checkSizes" || !text) return text;
  const list = Array.isArray(v) ? (v as string[]) : text.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  return checkLabel({ checkSizes: list }, text);
}

export default async function Dashboard() {
  kickMailSync();
  kickBlasts();
  const me = await currentUser();
  // Microsoft is never asked during the render. What you just sent, drafts that went out and Handle emails that
  // went out are picked up after the page is served (throttled); the next load shows the result.
  kickDashboardRefresh(me?.email);
  const showCriteria = Boolean(me?.canEditCriteria);
  // Data updates is on every teammate's dashboard (Jonathan, Oct 29, 2026: Aviel sees what is waiting on Jonathan and can remind
  // him); the buttons only work for Jonathan, everyone else sees them greyed out
  const showData = Boolean(me);
  const todos = me?.email ? await prisma.reminder.findMany({ where: { userEmail: me.email.toLowerCase(), doneAt: null }, orderBy: { createdAt: "desc" } }) : [];
  const [proposals, quiet, momentum, intros, readyDeals, stale, dupes, reports] = await Promise.all([
    showData ? prisma.criteriaProposal.findMany({ where: { status: "PENDING", createdAt: { gte: HOME_SINCE } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    quietInvestors(),
    listMomentum(HOME_SINCE),
    quietIntros(),
    prisma.deal.findMany({ where: { stage: "Engagement Letter Signed" }, include: { owner: { select: { name: true } }, _count: { select: { investors: true } } }, orderBy: { updatedAt: "desc" } }),
    showData ? staleDeals() : Promise.resolve([]),
    showData ? possibleDuplicates() : Promise.resolve([]),
    reportsDue().catch(() => [] as ReportDue[]),
  ]);

  const companies = new Map((await prisma.company.findMany({ where: { id: { in: proposals.map((p) => p.companyId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const people = new Map((await prisma.contact.findMany({ where: { id: { in: proposals.map((p) => p.contactId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true } })).map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ")]));
  const dealNames = new Map((await prisma.deal.findMany({ where: { id: { in: proposals.map((p) => p.dealId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  // departures the mailbox history turned up (the notice is older than sixty days): one group, one decision (Jonathan, Oct 13, 2026)
  const removalRefs = proposals.filter((p) => p.changes.includes("removeContact") && p.sourceRef).map((p) => p.sourceRef as string);
  const refDates = new Map((removalRefs.length ? await prisma.activity.findMany({ where: { externalId: { in: removalRefs } }, select: { externalId: true, occurredAt: true } }) : []).map((a) => [a.externalId as string, a.occurredAt]));
  const olderRemovals = proposals.filter((p) => p.changes.includes("removeContact") && p.sourceRef && (refDates.get(p.sourceRef)?.getTime() ?? Date.now()) < Date.now() - 60 * 86_400_000);
  const olderIds = new Set(olderRemovals.map((p) => p.id));
  const dataCount = proposals.length - olderRemovals.length + (olderRemovals.length ? 1 : 0) + stale.length + dupes.length;
  const today = new Date();
  const quietCount = quiet.reduce((n, g) => n + g.rows.length, 0);
  const cols = showData ? "2xl:grid-cols-5" : "2xl:grid-cols-4";

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
                  {g.rows.map((r) => {
                    // the row's person, or anyone else at the firm, can be written to; otherwise the row says so (Sep 17: three faded Handles with no explanation)
                    const ownOk = Boolean(r.contact.email) && !r.contact.unsubscribed && !r.contact.departedAt;
                    const reachable = ownOk || (r.contact.company?.contacts.length ?? 0) > 0;
                    return (
                    <Item key={r.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate">{r.contact.company?.name ?? investorLabel(r.contact)}</div>
                        <div className="truncate text-xs text-muted">
                          {days(r.updatedAt)}d{r.status === 3 ? " · followed up" : ""}
                          {r.followUpDraftId ? " · draft in Outlook" : ""}
                          {!reachable && (
                            <>
                              {" · "}
                              <Link href={r.contact.company ? `/companies/${r.contact.company.id}` : `/contacts/${r.contact.id}`} className="text-red-700 hover:underline" title="Nobody at this firm has an email the CRM may write to">
                                {r.contact.unsubscribed ? "unsubscribed, no other contact" : "no email on file"} · add a contact
                              </Link>
                            </>
                          )}
                          {reachable && !ownOk && " · goes to a colleague"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <ItemForm action={dismissFollowUps.bind(null, [r.id])} className="text-[11px] text-muted hover:text-ink" title="Take this LP off the list (they stay on the progress report)">✕</ItemForm>
                        <DraftButton label={r.followUpDraftId ? "Open" : "Handle"} action={openFollowUp.bind(null, r.id)} disabled={!reachable} title={reachable ? "Reply-all to the deal email with the attachments, your signature" : "Nobody at this firm has an email the CRM may write to; add a contact on the company page"} />
                      </div>
                    </Item>
                    );
                  })}
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
                    {(() => {
                      // at most eight lines: open asks as bullets, a count of what the ticket already answers; the full text on hover
                      const v = momentumLines(m.kind, m.summary);
                      return (
                        <div className="mt-0.5 line-clamp-[8] text-xs leading-snug text-ink-soft" title={m.summary ?? undefined}>
                          {m.kind === "LP_ASK" && <div>{m.party} asks:</div>}
                          {v.lines.map((l, i) => <div key={i}>{l}</div>)}
                          {v.more && <div className="text-muted">{v.more}</div>}
                        </div>
                      );
                    })()}
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
                    <div className="font-semibold">{introTitle(i)}</div>
                    <div className="truncate text-xs text-muted">
                      {i.introducedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} {i.mailbox === "hubspot" ? "from HubSpot" : `by ${i.mailbox.split("@")[0]}`} · quiet {days(i.lastActivityAt)}d · {i.replies} {i.mailbox === "hubspot" ? `email${i.replies === 1 ? "" : "s"}` : `repl${i.replies === 1 ? "y" : "ies"}`}
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
                    <DraftButton block label={r.draftOpen ? "Open" : "Handle"} action={openReportDraftAction.bind(null, r.id)} title={r.draftOpen ? "The draft is in your Outlook Drafts; this opens it (with today's report if the tracker moved)" : "Reply all on your latest exchange with the sponsor, the fresh progress report attached"} />
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

        {(!showCriteria || todos.length > 0) && (
          <Window title="To do" count={todos.length} empty="Nothing on your list. Forward an email to deals@ with a note like “remind me to handle this” and it lands here with the people from the email.">
            <ul className="divide-y divide-line">
              {todos.map((t) => {
                let people: string[] = [];
                try {
                  people = t.people ? (JSON.parse(t.people) as string[]) : [];
                } catch {
                  people = [];
                }
                return (
                  <Item key={t.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div>{t.text}</div>
                      {people.length > 0 && <div className="mt-0.5 text-xs text-muted">{people.join(" · ")}</div>}
                      <div className="mt-0.5 text-[11px] text-muted">
                        {t.subject ? `${t.subject} · ` : ""}
                        {t.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </div>
                    <ItemForm action={dismissTodoAction.bind(null, t.id)} className="btn-grey act" title="Done; this leaves the list for good">
                      Dismiss
                    </ItemForm>
                  </Item>
                );
              })}
            </ul>
          </Window>
        )}
        {showData && (
          <Window title={showCriteria ? "Data updates" : "Data updates · waiting on Jonathan"} count={dataCount} empty="Nothing to approve. Criteria corrections from investor emails, notes, calls or teammates, people who left their firm, and deals that went quiet land here.">
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
                    {showCriteria ? <ItemForm action={mergeDealsAction.bind(null, d.b.id, d.a.id)} className="btn-soft act" title={`Fold "${d.b.name}" into "${d.a.name}" (the ticket with more on it); emails, files, report rows and notes all move over`}>Merge into first</ItemForm> : <Locked>Merge into first</Locked>}
                    {showCriteria ? <ItemForm action={notDuplicateAction.bind(null, d.a.id, d.b.id)} className="btn-grey act">Not the same</ItemForm> : <Locked>Not the same</Locked>}
                  </div>
                </Item>
              ))}
            </ul>
            {stale.length > 0 && (
              <div className="border-b border-line bg-cream-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Deals gone quiet ({stale.length}) · nothing for {STALE_DAYS}+ days, Deal Received through Intro To Capital Made
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
                    {showCriteria ? <DraftButton block label="Handle" action={handleStaleDeal.bind(null, d.id)} title="Open a check-in email on the thread this deal came through" /> : <Locked>Handle</Locked>}
                    {showCriteria ? <ItemForm action={keepDealAction.bind(null, d.id)} className="btn-grey act" title={`Still alive; ask me again in ${STALE_DAYS} quiet days`}>Keep</ItemForm> : <Locked>Keep</Locked>}
                    {showCriteria ? <ItemForm action={markDealLostAction.bind(null, d.id)} className="act-lost" title="Move to Deal Lost; it leaves Deal momentum and LP follow-ups">Mark as deal lost</ItemForm> : <Locked>Mark as deal lost</Locked>}
                  </div>
                </Item>
              ))}
              {olderRemovals.length > 0 && (
                <Item className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">Older departures from the mailbox history ({olderRemovals.length})</div>
                    <div className="mt-0.5 text-xs text-muted">Auto-replies and bounces from more than sixty days ago, read when the mailboxes were backfilled. Approve marks them all departed (no more emails, off the pickers); each stays in the CRM.</div>
                    <div className="mt-1 line-clamp-3 text-xs text-ink-soft">{olderRemovals.map((p) => `${p.contactId ? people.get(p.contactId) || "Contact" : "Contact"}${p.companyId && companies.get(p.companyId) ? ` (${companies.get(p.companyId)})` : ""}`).join(" · ")}</div>
                  </div>
                  <div className="act-col">
                    {showCriteria ? <ItemForm action={approveProposals.bind(null, olderRemovals.map((p) => p.id))} className="btn-soft act">Approve all</ItemForm> : <Locked>Approve all</Locked>}
                    {showCriteria ? <ItemForm action={dismissProposals.bind(null, olderRemovals.map((p) => p.id))} className="btn-grey act">Dismiss all</ItemForm> : <Locked>Dismiss all</Locked>}
                  </div>
                </Item>
              )}
              {proposals.filter((p) => !olderIds.has(p.id)).map((p) => {
                const changes = JSON.parse(p.changes) as Change[];
                return (
                  <Item key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={p.dealId ? `/deals/${p.dealId}` : p.contactId && changes.some((c) => c.field === "removeContact") ? `/contacts/${p.contactId}` : `/companies/${p.companyId}`} className="font-semibold hover:underline">
                        {p.dealId ? dealNames.get(p.dealId) ?? "Deal" : changes.some((c) => c.field === "removeContact") && p.contactId ? `${people.get(p.contactId) || "Contact"}${p.companyId && companies.get(p.companyId) ? ` · ${companies.get(p.companyId)}` : ""}` : (p.companyId && companies.get(p.companyId)) ?? "Investor"}
                      </Link>
                      <span className="shrink-0 text-[11px] text-muted">{p.source === "NAMING" ? "naming" : p.source === "NOTE" ? "note" : p.source === "EMAIL" ? "email" : p.source === "FIREFLIES" ? "call" : p.sourceRef ?? "teammate"}</span>
                    </div>
                    <ul className="mt-1 space-y-1">
                      {changes.map((c) => (
                        <Item key={c.field} className="text-xs">
                          <span className="text-muted">{EXTRA_FIELD_LABELS[c.field] ?? PROPOSAL_FIELDS[c.field as ProposalField]?.label ?? c.field}:</span> <span className="line-through text-muted">{showProposalValue(c.field, c.from) || "blank"}</span> <span className="font-medium">{showProposalValue(c.field, c.to)}</span>
                          {c.evidence && <div className="italic text-muted">“{c.evidence}”</div>}
                        </Item>
                      ))}
                    </ul>
                    </div>
                    <div className="act-col">
                      {showCriteria ? <ItemForm action={approveProposal.bind(null, p.id)} className="btn-soft act">Approve</ItemForm> : <Locked>Approve</Locked>}
                      {showCriteria ? <ItemForm action={dismissProposal.bind(null, p.id)} className="btn-grey act">Dismiss</ItemForm> : <Locked>Dismiss</Locked>}
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
