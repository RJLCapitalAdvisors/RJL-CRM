import { prisma } from "@/lib/db";
import { graph, copyAttachment, createDraft, createReplyAllDraft, getMessage, graphConfigured, listAttachments, outlookDesktopLink, recentSent, sentMessagesTo, sentMessagesToDomain, updateDraftBody, type GraphMessage } from "@/lib/graph";
import { domainOf } from "@/lib/domains";
import { investorLabel } from "@/lib/tracker";
import { subjectLine } from "@/lib/deal-copy";

/**
 * "Handle": build the follow-up in the sender's own Outlook mailbox as a reply-all to the deal
 * email that went to this LP, with the original attachments re-attached, "Hi Name - please confirm
 * receipt." in Calibri 11 and the sender's signature. The draft opens in Outlook; the LP only moves
 * to Followed Up once Outlook shows the draft was actually sent (see syncFollowUpDrafts).
 */

const FONT = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
const QUOTE_MARKERS = [/<div[^>]+id=["']appendonsend["']/i, /<div[^>]+id=["']divRplyFwdMsg["']/i, /<hr[^>]*>/i, /<b>From:<\/b>/i, /-----Original Message-----/i, /<blockquote/i];

function stripQuoted(html: string) {
  let cut = html.length;
  for (const re of QUOTE_MARKERS) {
    const m = html.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return html.slice(0, cut);
}

/** Best-effort: the signature block at the bottom of one of the user's recent sent emails. */
export function deriveSignature(html: string, displayName: string): string | null {
  const own = stripQuoted(html);
  const text = own.replace(/<[^>]+>/g, " ");
  if (!text.includes(displayName)) return null;
  const idx = own.lastIndexOf(displayName);
  if (idx < 0) return null;
  const openers = [own.lastIndexOf("<div", idx), own.lastIndexOf("<p", idx), own.lastIndexOf("<table", idx)];
  const start = Math.max(...openers);
  if (start < 0) return null;
  const sig = own.slice(start).trim();
  return sig.length > 20 && sig.length < 20000 ? sig : null;
}

export async function signatureFor(mailbox: string): Promise<string> {
  const user = await prisma.user.findFirst({ where: { email: mailbox } });
  if (user?.signatureHtml) return user.signatureHtml;
  const name = user?.name ?? mailbox;
  try {
    for (const m of await recentSent(mailbox, 8)) {
      const sig = m.body?.content ? deriveSignature(m.body.content, name) : null;
      if (sig) {
        if (user) await prisma.user.update({ where: { id: user.id }, data: { signatureHtml: sig } });
        return sig;
      }
    }
  } catch {
    /* fall through to plain signature */
  }
  return `<div style="${FONT}">${name}<br>RJL Capital Advisors</div>`;
}

function insertAtTop(bodyHtml: string, block: string) {
  const m = bodyHtml.match(/<body[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return bodyHtml.slice(0, at) + block + bodyHtml.slice(at);
  }
  return block + bodyHtml;
}

export type FollowUpResult = { ok: true; webLink: string; outlookLink: string | null; messageId: string | null; mode: "replyAll" | "new"; attachments: number } | { ok: false; reason: string };

export async function createFollowUpDraft(rowId: string, mailbox: string): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const row = await prisma.dealInvestor.findUnique({ where: { id: rowId }, include: { contact: { include: { company: true } }, deal: true } });
  if (!row) return { ok: false, reason: "row not found" };
  const email = row.contact.email;
  if (!email) return { ok: false, reason: `${investorLabel(row.contact)} has no email address on file` };

  // an unsent draft from an earlier click: reopen it instead of making another
  if (row.followUpDraftId && row.followUpMailbox) {
    try {
      const d = await getMessage(row.followUpMailbox, row.followUpDraftId, "id,isDraft,webLink,internetMessageId");
      if (d.isDraft && d.webLink) return { ok: true, webLink: d.webLink, outlookLink: await outlookDesktopLink(row.followUpMailbox, d.id), messageId: d.internetMessageId ?? null, mode: "replyAll", attachments: 0 };
    } catch {
      /* draft gone; make a new one */
    }
  }

  const first = row.contact.firstName?.trim();
  const greeting = `<div style="${FONT}"><p style="margin:0 0 12pt 0;${FONT}">Hi${first ? ` ${first}` : ""} - please confirm receipt.</p>${await signatureFor(mailbox)}<br></div>`;

  // The deal email that actually went to this firm. Look at mail to this person first, then to anyone at the
  // firm's domain (the report may list a colleague of the person we really wrote to), matching on the deal name.
  const dealName = (row.deal.propertyName ?? row.deal.name).toLowerCase();
  const words = dealName.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const aboutDeal = (m: GraphMessage) => words.some((w) => (m.subject ?? "").toLowerCase().includes(w));
  const toPerson = await sentMessagesTo(mailbox, email, 15);
  const dom = row.contact.company?.domain ?? domainOf(email);
  const toFirm = dom ? await sentMessagesToDomain(mailbox, dom, 25) : [];
  // 1) the deal email itself (to this person, else to anyone at the firm); 2) else the latest thread with the firm
  const original = toPerson.find(aboutDeal) ?? toFirm.find(aboutDeal) ?? [...toPerson, ...toFirm].sort((a, b) => (b.sentDateTime ?? "").localeCompare(a.sentDateTime ?? ""))[0];

  let draft;
  let attachments = 0;
  if (original) {
    draft = await createReplyAllDraft(mailbox, original.id);
    await updateDraftBody(mailbox, draft.id, insertAtTop(draft.body?.content ?? "", greeting));
    if (original.hasAttachments) {
      for (const att of await listAttachments(mailbox, original.id)) {
        if (att.isInline) continue;
        if (await copyAttachment(mailbox, original.id, att, draft.id)) attachments++;
      }
    }
  } else {
    draft = await createDraft(mailbox, { subject: `RE: ${subjectLine(row.deal as unknown as Record<string, unknown>)}`, toRecipients: [email], bodyHtml: `<html><body>${greeting}</body></html>` });
  }
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
  // keep updatedAt as it was: the LP has not been followed up with until the draft is actually sent
  await prisma.dealInvestor.update({ where: { id: rowId }, data: { followUpDraftId: draft.id, followUpDraftAt: new Date(), followUpMailbox: mailbox, updatedAt: row.updatedAt } });
  return { ok: true, webLink: fresh.webLink ?? draft.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: original ? "replyAll" : "new", attachments };
}

/**
 * Rows with an open follow-up draft: ask Outlook whether it has been sent. Sent -> status 3 (Followed Up),
 * timer restarts. Deleted draft -> forget it so Handle makes a new one.
 */
export async function syncFollowUpDrafts(): Promise<number> {
  if (!graphConfigured()) return 0;
  import("@/lib/engagement").then((m) => m.syncEngagementDrafts().catch(() => 0)).catch(() => 0);
  import("@/lib/send-deal").then((m) => m.syncSendDrafts().catch(() => 0)).catch(() => 0);
  const rows = await prisma.dealInvestor.findMany({ where: { followUpDraftId: { not: null } }, select: { id: true, followUpDraftId: true, followUpMailbox: true, contactId: true, dealId: true } });
  let sent = 0;
  await Promise.all(
    rows.map(async (r) => {
      try {
        const m = await getMessage(r.followUpMailbox!, r.followUpDraftId!, "id,isDraft,sentDateTime,subject");
        if (m.isDraft) return;
        await prisma.dealInvestor.update({ where: { id: r.id }, data: { status: 3, followUpDraftId: null, followUpDraftAt: null, followUpMailbox: null, updatedAt: m.sentDateTime ? new Date(m.sentDateTime) : new Date() } });
        const { logActivity } = await import("@/lib/activity");
        await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: m.subject ?? "Follow-up", body: "Follow-up sent from Outlook (Handle)", contactId: r.contactId, dealId: r.dealId, occurredAt: m.sentDateTime ? new Date(m.sentDateTime) : new Date() });
        sent++;
      } catch (e) {
        if (String(e).includes("404")) await prisma.dealInvestor.update({ where: { id: r.id }, data: { followUpDraftId: null, followUpDraftAt: null, followUpMailbox: null } });
      }
    }),
  );
  return sent;
}

/** Reply-all draft on the latest message of a thread (found by Internet Message-ID), body = just the signature. */
export async function createThreadReplyDraft(mailbox: string, internetMessageId: string): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const found = await graph<{ value: GraphMessage[] }>(`/users/${encodeURIComponent(mailbox)}/messages?$filter=internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'&$select=id,subject`);
  const msg = found.value[0];
  if (!msg) return { ok: false, reason: "That email is not in your mailbox (it may be in a teammate's)." };
  const draft = await createReplyAllDraft(mailbox, msg.id);
  const sig = await signatureFor(mailbox);
  await updateDraftBody(mailbox, draft.id, insertAtTop(draft.body?.content ?? "", `<div style="${FONT}"><p style="margin:0 0 12pt 0;${FONT}"><br></p>${sig}<br></div>`));
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: "replyAll", attachments: 0 };
}

/**
 * Fallback when the thread we recorded is not in this mailbox (it was in a teammate's or in deals@):
 * reply-all to the latest email in MY mailbox with that person (preferring one that mentions the deal),
 * else start a fresh email to them with the deal in the subject. Body is blank with my signature.
 */
export async function replyToLatestWith(mailbox: string, email: string, subjectHint: string, dealWords: string[] = []): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const sent = await sentMessagesTo(mailbox, email, 15).catch(() => [] as GraphMessage[]);
  const about = (m: GraphMessage) => dealWords.some((w) => (m.subject ?? "").toLowerCase().includes(w));
  const original = sent.find(about) ?? sent[0];
  const sig = await signatureFor(mailbox);
  const blank = `<div style="${FONT}"><p style="margin:0 0 12pt 0;${FONT}"><br></p>${sig}<br></div>`;
  let draft: GraphMessage;
  let mode: "replyAll" | "new" = "new";
  if (original) {
    draft = await createReplyAllDraft(mailbox, original.id);
    await updateDraftBody(mailbox, draft.id, insertAtTop(draft.body?.content ?? "", blank));
    mode = "replyAll";
  } else {
    draft = await createDraft(mailbox, { subject: subjectHint, toRecipients: [email], bodyHtml: `<html><body>${blank}</body></html>` });
  }
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode, attachments: 0 };
}
