import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  DRAFT: "bg-cream text-ink border-line",
  SENDING: "bg-sky text-ink border-sky",
  SENT: "bg-emerald-100 text-emerald-900 border-emerald-200",
  PARTIAL: "bg-amber-100 text-amber-900 border-amber-200",
};

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { deal: true, template: true, recipients: { select: { status: true } } },
  });
  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Deal emails sent to matched investors or sponsors"
        actions={
          <Link href="/campaigns/new" className="btn-primary">
            New campaign
          </Link>
        }
      />
      <div className="px-8 py-6">
        {campaigns.length === 0 ? (
          <Empty>
            No campaigns yet. Open a deal and choose <strong>New campaign</strong>, or start one here.
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Deal</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th className="text-right">Recipients</th>
                  <th className="text-right">Sent</th>
                  <th className="text-right">Failed</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const sent = c.recipients.filter((r) => r.status === "SENT" || r.status === "OPENED" || r.status === "CLICKED").length;
                  const failed = c.recipients.filter((r) => r.status === "FAILED" || r.status === "BOUNCED").length;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted">{c.template?.name}</div>
                      </td>
                      <td>
                        {c.deal && (
                          <Link href={`/deals/${c.deal.id}`} className="hover:underline">
                            {c.deal.propertyName ?? c.deal.name}
                          </Link>
                        )}
                      </td>
                      <td>{c.roleFilter ?? "All roles"}</td>
                      <td>
                        <span className={`chip border ${tone[c.status] ?? tone.DRAFT}`}>{c.status}</span>
                      </td>
                      <td className="text-right">{c.recipients.length}</td>
                      <td className="text-right">{sent}</td>
                      <td className="text-right">{failed}</td>
                      <td className="whitespace-nowrap text-muted">{fmtDate(c.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
