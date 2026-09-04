import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { stageTone } from "@/lib/taxonomy";
import { PageHeader } from "@/components/ui";
import { DealForm } from "@/components/deal-form";
import { updateDeal } from "../actions";
import { DealPreview } from "@/components/deal-preview";
import { parseDetails } from "@/lib/checklist";
import { completeness } from "@/lib/checklist";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, users, templates] = await Promise.all([
    prisma.deal.findUnique({
      where: { id },
      include: {
        owner: true,
        sponsorCompany: true,
        activities: { orderBy: { occurredAt: "desc" }, take: 40, include: { contact: true } },
        investors: { select: { status: true } },
        campaigns: { select: { id: true, followUp: true, recipients: { select: { status: true } } } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", NOT: { name: { contains: "Engagement" } } }, orderBy: { name: "asc" }, select: { id: true, name: true, subject: true, bodyHtml: true } }),
  ]);
  if (!deal) notFound();
  const update = updateDeal.bind(null, deal.id);
  const { answered, total } = completeness(deal);

  return (
    <>
      <PageHeader
        title={deal.propertyName ?? deal.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span className={`chip border ${stageTone(deal.stage)}`}>{deal.stage}</span>
            {deal.sponsorCompany ? (
              <Link href={`/companies/${deal.sponsorCompany.id}`} className="hover:underline">
                {deal.sponsorCompany.name}
              </Link>
            ) : (
              deal.sponsorName && <span>{deal.sponsorName}</span>
            )}
            {deal.owner && <span>· {deal.owner.name}</span>}
            {deal.hubspotId && <span className="text-xs">· HubSpot {deal.hubspotId}</span>}
          </span>
        }
        actions={
          <>
            <Link href="/deals" className="btn-secondary">
              Back to board
            </Link>
            <Link href={`/deals/${deal.id}/tracker`} className="btn-secondary">
              Progress tracker
            </Link>
            <Link href={`/campaigns/new?dealId=${deal.id}`} className="btn-primary">
              Send deal
            </Link>
          </>
        }
      />
      <div className="mx-8 mt-6 grid grid-cols-4 overflow-hidden rounded-lg border border-line bg-paper text-sm">
        <div className="border-r border-line px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">1 · Items from sponsor</div>
          <div className="mt-0.5 font-semibold">{total - answered === 0 ? "All received" : `${total - answered} still needed`}</div>
          <div className="text-xs text-muted">
            <Link href={`/deals/${deal.id}/tracker`} className="underline">
              See the list
            </Link>
          </div>
        </div>
        <div className="border-r border-line px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">2 · Send deal</div>
          <div className="mt-0.5 font-semibold">{deal.campaigns.filter((c) => !c.followUp).reduce((n, c) => n + c.recipients.filter((r) => r.status === "SENT").length, 0)} emails sent</div>
          <div className="text-xs text-muted">
            <Link href={`/campaigns/new?dealId=${deal.id}`} className="underline">
              Pick a template and investors
            </Link>
          </div>
        </div>
        <div className="border-r border-line px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">3 · Track responses</div>
          <div className="mt-0.5 font-semibold">
            {deal.investors.filter((r) => r.status >= 4).length} responded · {deal.investors.filter((r) => r.status === 2 || r.status === 3).length} waiting
          </div>
          <div className="text-xs text-muted">
            <Link href={`/deals/${deal.id}/tracker`} className="underline">
              Open progress report
            </Link>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">4 · Follow up</div>
          <div className="mt-0.5 font-semibold">{deal.campaigns.filter((c) => c.followUp).length} follow-up rounds</div>
          <div className="text-xs text-muted">
            <Link href={`/deals/${deal.id}/tracker`} className="underline">
              Follow up with non-responders
            </Link>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-6 px-8 py-6">
        <div className="col-span-2 space-y-6">
          <section className="card p-5">
            <DealForm deal={deal} users={users} action={update} />
          </section>
        </div>
        <section className="card sticky top-4 self-start">
          <DealPreview templates={templates} initial={{ ...deal, details: parseDetails(deal.details) }} senderName={deal.owner?.name ?? "RJL Capital Advisors"} />
        </section>
      </div>
    </>
  );
}
