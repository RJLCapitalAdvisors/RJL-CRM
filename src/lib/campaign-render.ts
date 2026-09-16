import { renderTemplate, toHtml, toText, UNSUBSCRIBE_FOOTER, type MergeContext } from "@/lib/merge";
import { FONT, outlookHtml } from "@/lib/email-html";
import { unsubscribeUrl } from "@/lib/tokens";

type CampaignLike = { mode: string; subject: string; bodyHtml: string; fromName: string | null; replyTo: string | null; deal: Record<string, unknown> | null };
type RecipientLike = {
  contactId: string;
  openingLine: string | null;
  bodyOverride: string | null;
  contact: { firstName: string | null; lastName: string | null; email: string | null; company: { name: string } | null };
};

export function senderName(campaign: { fromName: string | null }) {
  return campaign.fromName ?? (process.env.MAIL_FROM ?? "RJL Capital Advisors").replace(/<.*$/, "").trim();
}

/** Subject, HTML, and plain text for one recipient of a campaign. */
export function renderForRecipient(campaign: CampaignLike, r: RecipientLike) {
  const ctx: MergeContext = {
    contact: r.contact,
    company: r.contact.company,
    deal: campaign.deal,
    sender: { name: senderName(campaign) },
    unsubscribeUrl: unsubscribeUrl(r.contactId),
    openingLine: r.openingLine,
  };
  let body = r.bodyOverride ?? campaign.bodyHtml;
  if (campaign.mode === "BLAST" && !body.includes("{{unsubscribeUrl}}")) body += `\n${UNSUBSCRIBE_FOOTER}`;
  const subject = renderTemplate(campaign.subject, ctx);
  const html = `<div style="${FONT}">${outlookHtml(toHtml(renderTemplate(body, ctx)))}</div>`;
  const text = toText(renderTemplate(body, ctx));
  return { subject, html, text };
}

/** mailto: link that opens the recipient's email pre-filled in the default mail client (Outlook). */
export function mailtoLink(to: string, subject: string, text: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
