import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  DRAFT: "bg-cream text-ink border-line",
  SENDING: "bg-sky text-ink border-sky",
  IN_PROGRESS: "bg-sky-50 text-ink border-sky",
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
        title="Email blasts"
        subtitle="Blasts to a group, and the one-at-a-time deal sends, with their status"
        actions={
          <Link href="/campaigns/new" className="btn-primary">
            New email blast
          </Link>
        }
      />
      <div className="px-8 py-6">
        {campaigns.length === 0 ? (
          <Empty>
            Nothing sent yet. Open a deal and choose <strong>Send deal</strong>, or start a blast here.
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Deal</th>
                  <th>Mode</th>
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
                      <td className="text-xs">{c.mode === "BLAST" ? "Blast" : "One at a time"}</td>
                      <td>{c.roleFilter ?? "All roles"}</td>
                      <td>
                        <span className={`chip border ${tone[c.status] ?? tone.DRAFT}`}>{c.status.replace("_", " ")}</span>
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
