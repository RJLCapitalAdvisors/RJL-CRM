import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { renderTemplate, toHtml, type MergeContext } from "@/lib/merge";
import { mailConfigured } from "@/lib/mailer";
import { unsubscribeUrl } from "@/lib/tokens";
import { fmtDate, fullName, str } from "@/lib/format";
import { deleteCampaign, removeRecipient, sendCampaign, updateCampaignCopy } from "../actions";
import { SendButton } from "./send-button";

export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  PENDING: "bg-cream text-ink",
  SENT: "bg-emerald-100 text-emerald-900",
  FAILED: "bg-red-100 text-red-900",
  UNSUBSCRIBED: "bg-stone-200 text-ink",
  OPENED: "bg-sky text-ink",
  CLICKED: "bg-sky text-ink",
  BOUNCED: "bg-amber-100 text-amber-900",
};

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      deal: true,
      template: true,
      recipients: { orderBy: [{ matchScore: "desc" }], include: { contact: { include: { company: true } } } },
    },
  });
  if (!campaign) notFound();

  const previewId = str(sp.preview) || campaign.recipients[0]?.contactId;
  const previewRecipient = campaign.recipients.find((r) => r.contactId === previewId) ?? campaign.recipients[0];
  const senderName = campaign.fromName ?? (process.env.MAIL_FROM ?? "RJL Capital Advisors").replace(/<.*$/, "").trim();
  const ctx: MergeContext | null = previewRecipient
    ? {
        contact: previewRecipient.contact,
        company: previewRecipient.contact.company,
        deal: campaign.deal as unknown as Record<string, unknown>,
        sender: { name: senderName },
        unsubscribeUrl: unsubscribeUrl(previewRecipient.contactId),
      }
    : null;
  const previewSubject = ctx ? renderTemplate(campaign.subject, ctx) : "";
  const previewHtml = ctx ? toHtml(renderTemplate(campaign.bodyHtml, ctx)) : "";
  const pending = campaign.recipients.filter((r) => r.status === "PENDING").length;
  const configured = mailConfigured();
  const isDraft = campaign.status === "DRAFT";

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span className={`chip border border-line ${campaign.status === "SENT" ? "bg-emerald-100" : "bg-cream"}`}>{campaign.status}</span>
            {campaign.deal && (
              <Link href={`/deals/${campaign.deal.id}`} className="hover:underline">
                {campaign.deal.propertyName ?? campaign.deal.name}
              </Link>
            )}
            <span>· {campaign.roleFilter ?? "All roles"}</span>
            <span>· {campaign.recipients.length} recipients</span>
            {campaign.sentAt && <span>· sent {fmtDate(campaign.sentAt)}</span>}
          </span>
        }
        actions={
          <>
            <a href={`/campaigns/${campaign.id}/export`} className="btn-secondary">
              Export CSV
            </a>
            {isDraft && (
              <form action={deleteCampaign.bind(null, campaign.id)}>
                <button className="btn-ghost" type="submit">
                  Delete draft
                </button>
              </form>
            )}
            <SendButton action={sendCampaign.bind(null, campaign.id)} pending={pending} configured={configured} />
          </>
        }
      />

      {!configured && (
        <div className="mx-8 mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sending is not configured yet. Add <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> to <code>.env</code> and restart. Until then, use <strong>Export CSV</strong> to get every personalized subject and body for a mail merge from Outlook.
        </div>
      )}

      <div className="grid grid-cols-5 gap-6 px-8 py-6">
        <section className="col-span-3 space-y-6">
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold">Preview</h2>
              {previewRecipient && (
                <form method="get" className="flex items-center gap-2 text-sm">
                  <label htmlFor="preview" className="text-muted">
                    As
                  </label>
                  <select id="preview" name="preview" defaultValue={previewRecipient.contactId} className="input w-64">
                    {campaign.recipients.map((r) => (
                      <option key={r.id} value={r.contactId}>
                        {fullName(r.contact)} · {r.contact.company?.name ?? r.contact.email}
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary" type="submit">
                    Show
                  </button>
                </form>
              )}
            </div>
            {ctx ? (
              <div className="p-5">
                <div className="mb-1 text-xs text-muted">
                  To: {previewRecipient!.contact.email} · From: {senderName}
                  {campaign.replyTo && ` · Reply-to: ${campaign.replyTo}`}
                </div>
                <div className="mb-4 text-lg font-semibold">{previewSubject}</div>
                <div className="prose prose-sm max-w-none rounded-md border border-line bg-cream-50 p-5 text-sm leading-relaxed [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            ) : (
              <div className="p-5 text-sm text-muted">No recipients.</div>
            )}
          </div>

          {isDraft && (
            <details className="card">
              <summary className="cursor-pointer px-5 py-3 font-semibold">Edit copy for this campaign only</summary>
              <form action={updateCampaignCopy.bind(null, campaign.id)} className="space-y-3 border-t border-line p-5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="fromName">
                      From name
                    </label>
                    <input id="fromName" name="fromName" defaultValue={campaign.fromName ?? ""} className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor="replyTo">
                      Reply-to
                    </label>
                    <input id="replyTo" name="replyTo" defaultValue={campaign.replyTo ?? ""} className="input" />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="subject">
                    Subject
                  </label>
                  <input id="subject" name="subject" defaultValue={campaign.subject} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="bodyHtml">
                    Body
                  </label>
                  <textarea id="bodyHtml" name="bodyHtml" rows={14} defaultValue={campaign.bodyHtml} className="input font-mono text-[13px]" />
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary" type="submit">
                    Save copy
                  </button>
                </div>
              </form>
            </details>
          )}
        </section>

        <section className="card col-span-2 self-start">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold">Recipients ({campaign.recipients.length})</h2>
          </div>
          <div className="max-h-[75vh] overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th className="text-center">Score</th>
                  <th>Status</th>
                  {isDraft && <th></th>}
                </tr>
              </thead>
              <tbody>
                {campaign.recipients.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/campaigns/${campaign.id}?preview=${r.contactId}`} className="font-medium hover:underline">
                        {fullName(r.contact)}
                      </Link>
                      <div className="text-xs text-muted">{r.contact.company?.name ?? r.contact.email}</div>
                    </td>
                    <td className="text-center">
                      <span className="chip bg-sky-50">{r.matchScore}</span>
                    </td>
                    <td>
                      <span className={`chip ${tone[r.status] ?? tone.PENDING}`}>{r.status}</span>
                      {r.error && <div className="mt-1 max-w-[16rem] truncate text-[11px] text-red-700" title={r.error}>{r.error}</div>}
                    </td>
                    {isDraft && (
                      <td>
                        <form action={removeRecipient.bind(null, campaign.id, r.contactId)}>
                          <button className="text-xs text-muted hover:text-red-700" type="submit" title="Remove from campaign">
                            ✕
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
