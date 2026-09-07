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
      <PageHeader title="Home" subtitle={`${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${quietCount} LP${quietCount === 1 ? "" : "s"} to follow up with · ${proposals.length} criteria update${proposals.length === 1 ? "" : "s"} to approve`} />
      <div className="mx-auto grid max-w-[1120px] gap-5 px-8 py-6 text-[15px] leading-relaxed lg:grid-cols-[minmax(0,560px)_minmax(0,480px)]">
        {/* LPs who have gone quiet */}
        <div className="card flex max-h-[calc(100vh-150px)] flex-col">
          <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-cream px-5 py-3.5">
            <h2 className="text-base font-semibold">No response in {QUIET_AFTER_DAYS}+ days</h2>
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
                      {g.rows.map(({ row: r, href }) => (
                        <li key={r.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate">
                              {r.contact.company?.name ?? investorLabel(r.contact)}
                              {r.status === 3 && <span className="text-muted"> · already followed up</span>}
                            </div>
                            <div className="truncate text-sm text-muted">
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
                        <span className="shrink-0 text-xs text-muted">{p.source === "NOTE" ? "from a note" : p.source === "EMAIL" ? "from email" : p.source === "FIREFLIES" ? "from a call" : "manual"}</span>
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
      </div>
    </>
  );
}
