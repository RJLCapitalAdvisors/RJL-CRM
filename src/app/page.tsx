import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { investorLabel } from "@/lib/tracker";
import { syncFollowUpDrafts } from "@/lib/followup";
import { PROPOSAL_FIELDS, type Change } from "@/lib/criteria-proposals";
import { approveProposal, dismissProposal } from "./todo-actions";
import { DraftButton } from "./draft-button";
import { listMomentum } from "@/lib/momentum";
import { dismissMomentum, openFollowUp, openMomentumDraft } from "./todo-actions";
import { currentUser } from "@/lib/current-user";
import { kickMailSync } from "@/lib/mail-sync";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
/** An LP gets this long to respond to a deal (or a follow-up) before they show up as quiet. */
const QUIET_AFTER_DAYS = 2;
/** Home starts the clock here: anything that began before this date stays off the dashboard (the old backlog lives in the reports and deal pages). */
const HOME_SINCE = new Date("2026-08-31T00:00:00Z");
const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY);
const KIND: Record<string, string> = { SPONSOR_ITEMS: "waiting on sponsor", INTRO: "intro not scheduled", ACTION: "open action item", MENTIONED: "mentioned, never sent" };

/** LPs who were sent a deal (or followed up with) and have said nothing for QUIET_AFTER_DAYS, grouped by deal. */
async function quietInvestors() {
  // Outlook is the source of truth for "did the follow-up go out": check open drafts before listing.
  await syncFollowUpDrafts().catch(() => 0);
  const cutoff = new Date(Date.now() - QUIET_AFTER_DAYS * DAY);
  const rows = await prisma.dealInvestor.findMany({
    where: { status: { in: [2, 3] }, updatedAt: { lt: cutoff, gte: HOME_SINCE }, deal: { stage: { in: [...ACTIVE_STAGES] } } },
    include: { contact: { include: { company: { select: { name: true } } } }, deal: true },
    orderBy: { updatedAt: "asc" },
  });
  const byDeal = new Map<string, { deal: (typeof rows)[number]["deal"]; rows: { row: (typeof rows)[number] }[] }>();
  for (const r of rows) {
    const g = byDeal.get(r.dealId) ?? { deal: r.deal, rows: [] };
    g.rows.push({ row: r });
    byDeal.set(r.dealId, g);
  }
  return [...byDeal.values()].sort((a, b) => a.rows[0].row.updatedAt.getTime() - b.rows[0].row.updatedAt.getTime());
}

export default async function Dashboard() {
  kickMailSync(); // background: team mailboxes into the email log, deals@ inbox into deal tickets
  const me = await currentUser();
  const showCriteria = Boolean(me?.canEditCriteria);
  const [proposals, quiet, momentum] = await Promise.all([showCriteria ? prisma.criteriaProposal.findMany({ where: { status: "PENDING", createdAt: { gte: HOME_SINCE } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]), quietInvestors(), listMomentum(HOME_SINCE)]);
  const companies = new Map((await prisma.company.findMany({ where: { id: { in: proposals.map((p) => p.companyId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const today = new Date();
  const quietCount = quiet.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <PageHeader title="Home" subtitle={`${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${quietCount} LP${quietCount === 1 ? "" : "s"} to follow up with · ${proposals.length} criteria update${proposals.length === 1 ? "" : "s"} to approve`} />
      <div className="mx-auto grid max-w-[1600px] gap-5 px-8 py-6 text-[15px] leading-relaxed lg:grid-cols-2 2xl:grid-cols-3">
        {/* LPs who have gone quiet */}
        <div className="card flex max-h-[calc(100vh-150px)] flex-col">
          <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-cream px-5 py-3.5">
            <h2 className="text-base font-semibold">LP follow-ups</h2>
            <span className="text-sm text-muted">{quietCount}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {quiet.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">Everyone you have sent a deal to has responded, or got it less than {QUIET_AFTER_DAYS} days ago.</div>
            ) : (
              <ul className="divide-y divide-line">
                {quiet.map((g) => (
                  <li key={g.deal.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/deals/${g.deal.id}/tracker`} className="text-base font-semibold hover:underline">
                        {g.deal.propertyName ?? g.deal.name}
                      </Link>
                      <span className="text-sm text-muted">{g.rows.length} waiting</span>
                    </div>
                    <ul className="mt-3 space-y-3">
                      {g.rows.map(({ row: r }) => (
                        <li key={r.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate">
                              {r.contact.company?.name ?? investorLabel(r.contact)}
                              {r.status === 3 && <span className="text-muted"> · already followed up</span>}
                              {r.followUpDraftId && <span className="text-muted"> · draft waiting in Outlook</span>}
                            </div>
                            <div className="truncate text-sm text-muted">
                              {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ")}
                              {r.contact.email ? ` · ${r.contact.email}` : " · no email on file"} · {days(r.updatedAt)} days
                            </div>
                          </div>
                          <DraftButton label={r.followUpDraftId ? "Open draft" : "Handle"} action={openFollowUp.bind(null, r.id)} disabled={!r.contact.email || r.contact.unsubscribed} title={r.followUpDraftId ? "A draft is already waiting in Outlook" : "Reply-all to the deal email with the attachments, Calibri 11, your signature"} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Deal momentum: where a deal is waiting on somebody who is not an LP on a progress report */}
        <div className="card flex max-h-[calc(100vh-150px)] flex-col">
          <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-cream px-5 py-3.5">
            <h2 className="text-base font-semibold">Deal momentum</h2>
            <span className="text-sm text-muted">{momentum.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {momentum.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">Nothing stalled. This watches for sponsors who owe you items, intros where a call is not getting scheduled, open action items from calls, and deals mentioned but never sent.</div>
            ) : (
              <ul className="divide-y divide-line">
                {momentum.map((m) => (
                  <li key={m.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <Link href={`/deals/${m.dealId}`} className="font-semibold hover:underline">
                            {m.deal.propertyName ?? m.deal.name}
                          </Link>
                          <span className="text-sm text-muted">{KIND[m.kind] ?? m.kind}</span>
                        </div>
                        <div className="text-sm">
                          {m.party} · <span className="text-muted">{days(m.waitingSince)} days</span>
                        </div>
                        <div className="text-sm text-ink-soft">{m.summary}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <DraftButton action={openMomentumDraft.bind(null, m.id)} title="Opens a reply on that thread in Outlook, blank, with your signature" />
                        <form action={dismissMomentum.bind(null, m.id)}>
                          <button type="submit" className="text-xs text-muted hover:underline">
                            dismiss
                          </button>
                        </form>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Investor criteria updates to approve (Jonathan only) */}
        {showCriteria && (
        <div className="card flex max-h-[calc(100vh-150px)] flex-col">
          <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-cream px-5 py-3.5">
            <h2 className="text-base font-semibold">Criteria updates to approve</h2>
            <span className="text-sm text-muted">{proposals.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {proposals.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">Nothing to approve. When an investor tells us their check size, markets, or focus have changed (email reply, tracker note, Fireflies call), the correction shows up here.</div>
            ) : (
              <ul className="divide-y divide-line">
                {proposals.map((p) => {
                  const changes = JSON.parse(p.changes) as Change[];
                  return (
                    <li key={p.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/companies/${p.companyId}`} className="text-base font-semibold hover:underline">
                          {(p.companyId && companies.get(p.companyId)) ?? "Investor"}
                        </Link>
                        <span className="shrink-0 text-xs text-muted">{p.source === "NOTE" ? "from a note" : p.source === "EMAIL" ? "from email" : p.source === "FIREFLIES" ? "from a call" : `from ${p.sourceRef ?? "a teammate"}`}</span>
                      </div>
                      <ul className="mt-2 space-y-2">
                        {changes.map((c) => (
                          <li key={c.field}>
                            <span className="text-muted">{PROPOSAL_FIELDS[c.field]?.label ?? c.field}:</span> <span className="line-through text-muted">{c.from || "blank"}</span> <span className="font-medium">{c.to}</span>
                            {c.evidence && <div className="mt-0.5 text-sm italic text-muted">“{c.evidence}”</div>}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        <form action={approveProposal.bind(null, p.id)}>
                          <button className="btn-soft" type="submit">
                            Approve
                          </button>
                        </form>
                        <form action={dismissProposal.bind(null, p.id)}>
                          <button className="btn-ghost py-1.5 text-muted" type="submit">
                            Dismiss
                          </button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        )}
      </div>
    </>
  );
}
