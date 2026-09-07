import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { investorLabel } from "@/lib/tracker";
import { subjectLine } from "@/lib/deal-copy";
import { mailtoLink, renderForRecipient } from "@/lib/campaign-render";
import { PROPOSAL_FIELDS, type Change } from "@/lib/criteria-proposals";
import { approveProposal, dismissProposal } from "./todo-actions";
import { RespondNow } from "./respond-now";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
/** An LP gets this long to respond to a deal (or a follow-up) before they show up as quiet. */
const QUIET_AFTER_DAYS = 2;
const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY);

/** LPs who were sent a deal (or followed up with) and have said nothing for QUIET_AFTER_DAYS, grouped by deal. */
async function quietInvestors() {
  const cutoff = new Date(Date.now() - QUIET_AFTER_DAYS * DAY);
  const rows = await prisma.dealInvestor.findMany({
    where: { status: { in: [2, 3] }, updatedAt: { lt: cutoff }, deal: { stage: { in: [...ACTIVE_STAGES] } } },
    include: { contact: { include: { company: { select: { name: true } } } }, deal: true },
    orderBy: { updatedAt: "asc" },
  });
  // The original deal email each LP got, so the follow-up can carry the same subject line.
  const sends = await prisma.campaignRecipient.findMany({
    where: { status: "SENT", contactId: { in: rows.map((r) => r.contactId) }, campaign: { followUp: false, dealId: { in: [...new Set(rows.map((r) => r.dealId))] } } },
    include: { campaign: { include: { deal: true } }, contact: { include: { company: { select: { name: true } } } } },
    orderBy: { sentAt: "desc" },
  });
  const sentTo = new Map<string, (typeof sends)[number]>();
  for (const s of sends) {
    const k = `${s.campaign.dealId}:${s.contactId}`;
    if (!sentTo.has(k)) sentTo.set(k, s);
  }

  const byDeal = new Map<string, { deal: (typeof rows)[number]["deal"]; rows: { row: (typeof rows)[number]; href: string | null }[] }>();
  for (const r of rows) {
    const s = sentTo.get(`${r.dealId}:${r.contactId}`);
    const subject = s ? renderForRecipient({ ...s.campaign, deal: s.campaign.deal as unknown as Record<string, unknown> }, s).subject : subjectLine(r.deal as unknown as Record<string, unknown>);
    const first = r.contact.firstName?.trim();
    const href = r.contact.email && !r.contact.unsubscribed ? mailtoLink(r.contact.email, `RE: ${subject}`, `Hi${first ? ` ${first}` : ""} - please confirm receipt.`) : null;
    const g = byDeal.get(r.dealId) ?? { deal: r.deal, rows: [] };
    g.rows.push({ row: r, href });
    byDeal.set(r.dealId, g);
  }
  return [...byDeal.values()].sort((a, b) => a.rows[0].row.updatedAt.getTime() - b.rows[0].row.updatedAt.getTime());
}

export default async function Dashboard() {
  const [proposals, quiet] = await Promise.all([prisma.criteriaProposal.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" } }), quietInvestors()]);
  const companies = new Map((await prisma.company.findMany({ where: { id: { in: proposals.map((p) => p.companyId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const today = new Date();
  const quietCount = quiet.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <PageHeader title="To do" subtitle={`${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${quietCount} LP${quietCount === 1 ? "" : "s"} to follow up with · ${proposals.length} criteria update${proposals.length === 1 ? "" : "s"} to approve`} />
      <div className="grid gap-6 px-8 py-6 lg:grid-cols-2">
        {/* LPs who have gone quiet */}
        <div className="card flex max-h-[calc(100vh-150px)] flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">No response in {QUIET_AFTER_DAYS}+ days</h2>
            <span className="text-xs text-muted">{quietCount}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {quiet.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted">Everyone you have sent a deal to has responded, or got it less than {QUIET_AFTER_DAYS} days ago.</div>
            ) : (
              <ul className="divide-y divide-line">
                {quiet.map((g) => (
                  <li key={g.deal.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/deals/${g.deal.id}/tracker`} className="font-semibold hover:underline">
                        {g.deal.propertyName ?? g.deal.name}
                      </Link>
                      <span className="text-xs text-muted">{g.rows.length} waiting</span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {g.rows.map(({ row: r, href }) => (
                        <li key={r.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate">
                              {r.contact.company?.name ?? investorLabel(r.contact)}
                              {r.status === 3 && <span className="text-muted"> · already followed up</span>}
                            </div>
                            <div className="truncate text-xs text-muted">
                              {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ")}
                              {r.contact.email ? ` · ${r.contact.email}` : " · no email on file"} · {days(r.updatedAt)} days
                            </div>
                          </div>
                          <RespondNow rowId={r.id} href={href} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Investor criteria updates to approve */}
        <div className="card flex max-h-[calc(100vh-150px)] flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Criteria updates to approve</h2>
            <span className="text-xs text-muted">{proposals.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {proposals.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted">Nothing to approve. When an investor tells us their check size, markets, or focus have changed (email reply, tracker note, Fireflies call), the correction shows up here.</div>
            ) : (
              <ul className="divide-y divide-line">
                {proposals.map((p) => {
                  const changes = JSON.parse(p.changes) as Change[];
                  return (
                    <li key={p.id} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/companies/${p.companyId}`} className="font-semibold hover:underline">
                          {(p.companyId && companies.get(p.companyId)) ?? "Investor"}
                        </Link>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">{p.source === "NOTE" ? "from a note" : p.source === "EMAIL" ? "from email" : p.source === "FIREFLIES" ? "from a call" : "manual"}</span>
                      </div>
                      <ul className="mt-1.5 space-y-1.5">
                        {changes.map((c) => (
                          <li key={c.field} className="text-xs">
                            <span className="text-muted">{PROPOSAL_FIELDS[c.field]?.label ?? c.field}:</span> <span className="line-through text-muted">{c.from || "blank"}</span> <span className="font-medium">{c.to}</span>
                            {c.evidence && <div className="mt-0.5 italic text-ink-soft">“{c.evidence}”</div>}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex gap-2">
                        <form action={approveProposal.bind(null, p.id)}>
                          <button className="btn-primary px-2.5 py-1 text-xs" type="submit">
                            Approve
                          </button>
                        </form>
                        <form action={dismissProposal.bind(null, p.id)}>
                          <button className="btn-secondary px-2.5 py-1 text-xs" type="submit">
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
      </div>
    </>
  );
}
