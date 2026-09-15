import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { parseIlSegment } from "@/lib/il-blasts";

export const metadata = { title: "Email blasts" };
export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  DRAFT: "bg-cream text-ink border-line",
  SENDING: "bg-sky text-ink border-sky",
  SENT: "bg-emerald-100 text-emerald-900 border-emerald-200",
  PARTIAL: "bg-amber-100 text-amber-900 border-amber-200",
};

/** RJL Israel email blasts: every blast with its status; New opens the form. */
export default async function IlCampaignsPage() {
  const campaigns = await prisma.ilCampaign.findMany({ orderBy: { createdAt: "desc" }, include: { recipients: { select: { status: true } } } });
  return (
    <>
      <PageHeader
        title="Email blasts"
        subtitle="One email to a group of contacts: buyers, brokers, everyone. Sent through Resend with a one-click unsubscribe."
        actions={
          <Link href="/israel/campaigns/new" className="btn-primary">
            New email blast
          </Link>
        }
      />
      <div className="px-8 py-6">
        {campaigns.length === 0 ? (
          <Empty>No blasts yet. New email blast writes the first one.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Blast</th>
                  <th>Who</th>
                  <th className="text-center">People</th>
                  <th className="text-center">Sent</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const seg = parseIlSegment(c.segment);
                  const sent = c.recipients.filter((r) => r.status === "SENT").length;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/israel/campaigns/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="truncate text-xs text-muted">{c.subject}</div>
                      </td>
                      <td className="text-xs text-muted">{[seg.roles.length ? seg.roles.join(", ") : "Everyone", seg.city ? `wanting ${seg.city}` : null].filter(Boolean).join(" · ")}</td>
                      <td className="text-center">{c.recipients.length}</td>
                      <td className="text-center">{sent || <span className="text-muted">—</span>}</td>
                      <td>
                        <span className={`chip border text-[11px] ${tone[c.status] ?? tone.DRAFT}`}>{c.status.toLowerCase()}</span>
                      </td>
                      <td className="whitespace-nowrap text-muted">{fmtDate(c.sentAt ?? c.createdAt)}</td>
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
