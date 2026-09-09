import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { mailConfigured } from "@/lib/mailer";
import { mailtoLink, renderForRecipient, senderName } from "@/lib/campaign-render";
import { fmtDate, fullName, str } from "@/lib/format";
import { deleteCampaign, markRecipientSent, removeRecipient, sendCampaign, sendOneRecipient, skipRecipient, unskipRecipient, updateCampaignCopy, updateRecipient } from "../actions";
import { SendButton } from "./send-button";
import { BlastPanel } from "./blast-panel";
import { blastStats } from "@/lib/blasts";
import { currentUser } from "@/lib/current-user";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.campaign.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: c?.name ?? "Email blast" };
}

export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  PENDING: "bg-cream text-ink",
  SENT: "bg-emerald-100 text-emerald-900",
  FAILED: "bg-red-100 text-red-900",
  SKIPPED: "bg-stone-200 text-muted",
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
      recipients: { orderBy: [{ matchScore: "desc" }, { id: "asc" }], include: { contact: { include: { company: true } } } },
    },
  });
  if (!campaign) notFound();

  const configured = mailConfigured();
  const [stats, me] = campaign.mode === "BLAST" ? await Promise.all([blastStats(campaign.id), currentUser()]) : [null, null];
  const outreach = campaign.mode === "OUTREACH";
  const pending = campaign.recipients.filter((r) => r.status === "PENDING").length;
  const sent = campaign.recipients.filter((r) => r.status === "SENT").length;
  const dealCtx = { ...campaign, deal: campaign.deal as unknown as Record<string, unknown> | null };

  // Selected recipient: ?r=<recipientId>, ?preview=<contactId>, else first pending, else first.
  const rParam = str(sp.r);
  const previewContact = str(sp.preview);
  const selected =
    campaign.recipients.find((r) => r.id === rParam) ??
    campaign.recipients.find((r) => r.contactId === previewContact) ??
    campaign.recipients.find((r) => r.status === "PENDING") ??
    campaign.recipients[0];
  const rendered = selected ? renderForRecipient(dealCtx, selected) : null;
  const selIdx = selected ? campaign.recipients.findIndex((r) => r.id === selected.id) : -1;
  const prev = selIdx > 0 ? campaign.recipients[selIdx - 1] : null;
  const next = selIdx >= 0 && selIdx < campaign.recipients.length - 1 ? campaign.recipients[selIdx + 1] : null;

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span className={`chip border border-line ${campaign.status === "SENT" ? "bg-emerald-100" : "bg-cream"}`}>{campaign.status.replace("_", " ")}</span>
            <span className="chip bg-sky-50">{outreach ? "One at a time" : "Blast"}</span>
            {campaign.deal && (
              <Link href={`/deals/${campaign.deal.id}`} className="hover:underline">
                {campaign.deal.propertyName ?? campaign.deal.name}
              </Link>
            )}
            <span>· {campaign.roleFilter ?? "All roles"}</span>
            <span>
              · {sent} sent of {campaign.recipients.length}
            </span>
            {campaign.sentAt && <span>· finished {fmtDate(campaign.sentAt)}</span>}
          </span>
        }
        actions={
          <>
            <a href={`/campaigns/${campaign.id}/export`} className="btn-secondary">
              Export CSV
            </a>
            {sent === 0 && (
              <form action={deleteCampaign.bind(null, campaign.id)}>
                <button className="btn-ghost" type="submit">
                  Delete
                </button>
              </form>
            )}
            {!outreach && campaign.mode !== "BLAST" && <SendButton action={sendCampaign.bind(null, campaign.id)} pending={pending} configured={configured} />}
          </>
        }
      />

      {campaign.mode === "BLAST" && stats && <BlastPanel campaignId={campaign.id} status={campaign.status} scheduledAt={campaign.scheduledAt?.toISOString() ?? null} followUpDays={campaign.followUpDays} stats={stats} myEmail={me?.email ?? null} />}

      {!configured && !outreach && (
        <div className="mx-8 mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sending is not configured yet. Add <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> to <code>.env</code> and restart. Until then, use <strong>Export CSV</strong> for a mail merge from Outlook.
        </div>
      )}

      <div className="grid grid-cols-5 gap-6 px-8 py-6">
        {/* Recipient list */}
        <section className="card col-span-2 self-start">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">Recipients ({campaign.recipients.length})</h2>
            <span className="text-xs text-muted">
              {pending} to go · {sent} sent
            </span>
          </div>
          <div className="max-h-[75vh] overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th className="text-center">Fit</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaign.recipients.map((r) => (
                  <tr key={r.id} className={selected?.id === r.id ? "bg-sky-50" : ""}>
                    <td>
                      <Link href={`/campaigns/${campaign.id}?r=${r.id}`} className="font-medium hover:underline">
                        {fullName(r.contact)}
                      </Link>
                      <div className="text-xs text-muted">{r.contact.company?.name ?? r.contact.email}</div>
                    </td>
                    <td className="text-center">
                      <span className="chip bg-sky-50">{r.matchScore}</span>
                    </td>
                    <td>
                      <span className={`chip ${tone[r.status] ?? tone.PENDING}`}>{r.status}</span>
                      {r.sentVia && <div className="text-[10px] text-muted">via {r.sentVia}</div>}
                      {r.error && (
                        <div className="mt-1 max-w-[12rem] truncate text-[11px] text-red-700" title={r.error}>
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      {r.status === "SKIPPED" ? (
                        <form action={unskipRecipient.bind(null, r.id)}>
                          <button className="text-xs text-sky-600 hover:underline" type="submit">
                            Undo
                          </button>
                        </form>
                      ) : r.status === "PENDING" ? (
                        <form action={removeRecipient.bind(null, campaign.id, r.contactId)}>
                          <button className="text-xs text-muted hover:text-red-700" type="submit" title="Remove from list">
                            ✕
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Compose / preview */}
        <section className="col-span-3 space-y-6">
          {selected && rendered ? (
            <div className="card">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <div className="font-semibold">
                    {fullName(selected.contact)}
                    {selected.contact.company && <span className="font-normal text-muted"> · {selected.contact.company.name}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {selected.contact.email} · {JSON.parse(selected.matchReasons || "[]").join(" · ") || "no criteria match data"}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm">
                  {prev ? (
                    <Link href={`/campaigns/${campaign.id}?r=${prev.id}`} className="btn-ghost">
                      ← Prev
                    </Link>
                  ) : (
                    <span className="btn-ghost opacity-40">← Prev</span>
                  )}
                  <span className="text-muted">
                    {selIdx + 1} / {campaign.recipients.length}
                  </span>
                  {next ? (
                    <Link href={`/campaigns/${campaign.id}?r=${next.id}`} className="btn-ghost">
                      Next →
                    </Link>
                  ) : (
                    <span className="btn-ghost opacity-40">Next →</span>
                  )}
                </div>
              </div>

              {outreach && selected.status === "PENDING" && (
                <form action={updateRecipient.bind(null, selected.id)} className="space-y-3 border-b border-line bg-cream-50 p-5">
                  <div>
                    <label className="label" htmlFor="openingLine">
                      Personal opening line for {selected.contact.firstName ?? "this contact"}
                    </label>
                    <input id="openingLine" name="openingLine" defaultValue={selected.openingLine ?? ""} className="input" placeholder="great catching up at the conference last week." autoFocus />
                    <div className="mt-1 text-[11px] text-muted">
                      Goes where the template says {"{{openingLine}}"} (right after &ldquo;Hi {selected.contact.firstName ?? "Name"} –&rdquo;). Leave blank to use the template default.
                    </div>
                  </div>
                  <details open={Boolean(selected.bodyOverride)}>
                    <summary className="cursor-pointer text-xs text-muted">Rewrite the whole email for this person</summary>
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <input type="checkbox" name="useCustomBody" defaultChecked={Boolean(selected.bodyOverride)} className="accent-ink" /> Use custom body below (merge fields still work)
                    </label>
                    <textarea name="bodyOverride" rows={10} defaultValue={selected.bodyOverride ?? campaign.bodyHtml} className="input mt-2 font-mono text-[12px]" />
                  </details>
                  <div className="flex justify-end">
                    <button className="btn-secondary" type="submit">
                      Save &amp; refresh preview
                    </button>
                  </div>
                </form>
              )}

              <div className="p-5">
                <div className="mb-1 text-xs text-muted">
                  To: {selected.contact.email} · From: {senderName(campaign)}
                  {campaign.replyTo && ` · Reply-to: ${campaign.replyTo}`}
                </div>
                <div className="mb-4 text-lg font-semibold">{rendered.subject}</div>
                <div className="rounded-md border border-line bg-paper p-5 text-sm leading-relaxed [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: rendered.html }} />
              </div>

              {outreach && selected.status === "PENDING" && selected.contact.email && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                  <div className="flex items-center gap-2">
                    <a href={mailtoLink(selected.contact.email, rendered.subject, rendered.text)} className="btn-primary" title="Opens a pre-filled draft in Outlook. Send it there, then click Mark sent.">
                      Open in Outlook
                    </a>
                    <form action={markRecipientSent.bind(null, selected.id)}>
                      <button className="btn-secondary" type="submit" title="Record that you sent it from Outlook and jump to the next investor">
                        Mark sent → next
                      </button>
                    </form>
                    {configured && (
                      <form action={sendOneRecipient.bind(null, selected.id)}>
                        <button className="btn-secondary" type="submit" title="Send this one email now through the mail service">
                          Send now → next
                        </button>
                      </form>
                    )}
                  </div>
                  <form action={skipRecipient.bind(null, selected.id)}>
                    <button className="btn-ghost" type="submit">
                      Skip
                    </button>
                  </form>
                </div>
              )}
              {selected.status === "SENT" && (
                <div className="border-t border-line px-5 py-3 text-sm text-emerald-800">
                  Sent {fmtDate(selected.sentAt)}
                  {selected.sentVia ? ` via ${selected.sentVia}` : ""}.
                </div>
              )}
            </div>
          ) : (
            <div className="card p-5 text-sm text-muted">No recipients.</div>
          )}

          <details className="card">
            <summary className="cursor-pointer px-5 py-3 font-semibold">Edit the email copy for this send</summary>
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
                <textarea id="bodyHtml" name="bodyHtml" rows={14} defaultValue={campaign.bodyHtml} className="input font-mono text-[12px]" />
              </div>
              <div className="flex justify-end">
                <button className="btn-primary" type="submit">
                  Save copy
                </button>
              </div>
            </form>
          </details>
        </section>
      </div>
    </>
  );
}
