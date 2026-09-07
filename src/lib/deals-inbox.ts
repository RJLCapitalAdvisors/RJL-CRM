import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
import { assembleDealText, attachmentToText, emailHtmlToText } from "@/lib/attachments";
import { missingFor, itemLabel } from "@/lib/checklist";
import { intro, metricsHtml, subjectLine } from "@/lib/deal-copy";
import { processIntake } from "@/app/intake/actions";

/**
 * The deals@ mailbox. Every new email there is a deal someone on the team forwarded:
 *   1. read the email plus its PDF / Excel attachments,
 *   2. run the extractor and create the deal ticket (Deal Received) with everything we could fill in,
 *   3. reply on the same thread with the deal written the way it would go to investors, followed by
 *      the checklist items (acquisitions or development) that are still missing.
 * Each message is processed once (DealIntake.messageId).
 */

const MAILBOX = () => process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com";
const INTERNAL = /@(rjlcapadvisors|rjlequities)\.com$/i;
const q = (s: string) => encodeURIComponent(s);

type Msg = { id: string; internetMessageId?: string; subject: string | null; receivedDateTime: string; hasAttachments?: boolean; isRead?: boolean; from?: { emailAddress: { address: string; name?: string } }; body?: { contentType: string; content: string } };
type Att = { "@odata.type": string; id: string; name: string; contentType: string | null; size: number; isInline: boolean };

/** "From: Jane Doe <jane@sponsor.com>" inside a forwarded email: the person who really sent the deal. */
function forwardedSender(text: string): { name: string | null; email: string | null } {
  const m = text.match(/^\s*From:\s*(.+?)\s*<([^>\s]+@[^>\s]+)>/im) ?? text.match(/^\s*From:\s*([^\n<]*?)\s*(?:mailto:)?([\w.+-]+@[\w.-]+\.\w+)/im);
  if (!m) return { name: null, email: null };
  const email = m[2].toLowerCase();
  return INTERNAL.test(email) ? { name: null, email: null } : { name: m[1].replace(/["']/g, "").trim() || null, email };
}

async function readAttachments(messageId: string): Promise<{ names: string[]; texts: { name: string; text: string }[] }> {
  const r = await graph<{ value: Att[] }>(`/users/${q(MAILBOX())}/messages/${q(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
  const names: string[] = [];
  const texts: { name: string; text: string }[] = [];
  for (const a of r.value) {
    if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    names.push(a.name);
    if (a.size > 25 * 1024 * 1024) continue;
    const bytes = new Uint8Array(await graph<ArrayBuffer>(`/users/${q(MAILBOX())}/messages/${q(messageId)}/attachments/${q(a.id)}/$value`, { raw: true }));
    const text = await attachmentToText(a.name, a.contentType, bytes);
    if (text) texts.push({ name: a.name, text });
  }
  return { names, texts };
}

function replyHtml(deal: Record<string, unknown>, dealUrl: string): string {
  const missing = missingFor(deal as never);
  const strategy = (deal.strategy as string | null) ?? null;
  const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const list = missing.length
    ? `<ol style="margin:4pt 0 0 18pt;${font}">${missing.map((it) => `<li>${itemLabel(it, strategy)}</li>`).join("")}</ol>`
    : `<p style="${font}">Nothing. The ${strategy === "Development" ? "development" : "acquisitions"} checklist is complete.</p>`;
  return `<div style="${font}">
<p>Deal ticket created: <a href="${dealUrl}">${deal.propertyName ?? deal.name}</a> (Deal Received).</p>
<p><b>How it would read to investors</b></p>
<div style="border-left:3px solid #b7cfe8;padding:6pt 10pt;margin:0 0 12pt 0;">
<p style="margin:0 0 8pt 0;"><b>Subject:</b> ${subjectLine(deal)}</p>
<p style="margin:0 0 8pt 0;white-space:pre-wrap;">${intro(deal)}</p>
${metricsHtml(deal)}
</div>
<p><b>Still missing${strategy ? ` (${strategy.toLowerCase()} checklist)` : ""}</b></p>
${list}
<p style="color:#6b716e;font-size:9pt;">Reply to the sponsor for the missing items; when their answers come back to this mailbox the ticket updates itself. Edit anything on the ticket in the CRM.</p>
</div>`;
}

async function replyOnThread(msg: Msg, html: string) {
  const draft = await graph<{ id: string }>(`/users/${q(MAILBOX())}/messages/${q(msg.id)}/createReply`, { method: "POST", body: JSON.stringify({}) });
  const to = msg.from?.emailAddress.address ? [{ emailAddress: { address: msg.from.emailAddress.address } }] : [];
  await graph(`/users/${q(MAILBOX())}/messages/${q(draft.id)}`, { method: "PATCH", body: JSON.stringify({ body: { contentType: "html", content: html }, toRecipients: to }) });
  await graph(`/users/${q(MAILBOX())}/messages/${q(draft.id)}/send`, { method: "POST" });
}

export async function processDealsMessage(messageId: string): Promise<{ dealId: string; replied: boolean } | { skipped: string }> {
  const msg = await graph<Msg>(`/users/${q(MAILBOX())}/messages/${q(messageId)}?$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,isRead,from,body`);
  const ext = msg.internetMessageId ?? msg.id;
  if (await prisma.dealIntake.findUnique({ where: { messageId: ext } })) return { skipped: "already processed" };
  const fromAddr = msg.from?.emailAddress.address?.toLowerCase() ?? "";
  if (fromAddr === MAILBOX().toLowerCase()) return { skipped: "our own reply" };

  const bodyText = msg.body?.contentType === "html" ? emailHtmlToText(msg.body.content) : (msg.body?.content ?? "");
  const { names, texts } = msg.hasAttachments ? await readAttachments(msg.id) : { names: [], texts: [] };
  const rawText = assembleDealText(bodyText, texts);
  const fwd = forwardedSender(bodyText);
  const external = !INTERNAL.test(fromAddr);

  const intake = await processIntake({
    rawText,
    subject: (msg.subject ?? "").replace(/^\s*(fw|fwd|re):\s*/i, ""),
    fromName: external ? msg.from?.emailAddress.name ?? null : fwd.name,
    fromEmail: external ? fromAddr : fwd.email,
    toEmail: MAILBOX(),
    source: "WEBHOOK",
    attachments: names,
  });
  await prisma.dealIntake.update({ where: { id: intake.id }, data: { messageId: ext } });
  // whoever forwarded it to deals@ owns the deal
  const owner = fromAddr ? await prisma.user.findFirst({ where: { email: { equals: fromAddr, mode: "insensitive" } } }) : null;
  if (owner) await prisma.deal.update({ where: { id: intake.dealId }, data: { ownerId: owner.id } });

  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: intake.dealId } });
  const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  let replied = false;
  try {
    await replyOnThread(msg, replyHtml(deal as unknown as Record<string, unknown>, `${base}/deals/${deal.id}`));
    replied = true;
  } catch (e) {
    console.error("deals@ reply failed", e);
  }
  await graph(`/users/${q(MAILBOX())}/messages/${q(msg.id)}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => {});
  return { dealId: deal.id, replied };
}

/** Everything in the deals@ inbox that has not been turned into a deal yet. */
export async function processDealsInbox(): Promise<{ processed: number; skipped: number }> {
  if (!graphConfigured()) return { processed: 0, skipped: 0 };
  const r = await graph<{ value: Msg[] }>(`/users/${q(MAILBOX())}/mailFolders/inbox/messages?$top=25&$orderby=receivedDateTime desc&$select=id,internetMessageId,from`);
  let processed = 0, skipped = 0;
  for (const m of r.value) {
    const res = await processDealsMessage(m.id).catch((e) => ({ skipped: String(e).slice(0, 120) }));
    if ("skipped" in res) skipped++;
    else processed++;
  }
  return { processed, skipped };
}

/** Graph change notification so a forwarded deal is handled within seconds instead of on the next page load. */
export async function ensureDealsSubscription(): Promise<string> {
  if (!graphConfigured() || !process.env.APP_URL || !process.env.CRON_SECRET) return "not configured";
  const resource = `/users/${MAILBOX()}/mailFolders/inbox/messages`;
  const notificationUrl = `${process.env.APP_URL.replace(/\/$/, "")}/api/graph/notify`;
  const subs = await graph<{ value: { id: string; resource: string; expirationDateTime: string; notificationUrl: string }[] }>("/subscriptions");
  const mine = subs.value.find((s) => s.resource.toLowerCase() === resource.toLowerCase() && s.notificationUrl === notificationUrl);
  const expiration = new Date(Date.now() + 4000 * 60_000).toISOString(); // just under Graph's ~3-day maximum for mail
  if (mine) {
    await graph(`/subscriptions/${mine.id}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime: expiration }) });
    return `renewed ${mine.id}`;
  }
  const created = await graph<{ id: string }>("/subscriptions", { method: "POST", body: JSON.stringify({ changeType: "created", notificationUrl, resource, expirationDateTime: expiration, clientState: process.env.CRON_SECRET }) });
  return `created ${created.id}`;
}

/** Re-send the summary reply for a deal that came through the mailbox (e.g. after editing the ticket). */
export async function sendDealsReply(dealId: string): Promise<boolean> {
  const it = await prisma.dealIntake.findFirst({ where: { dealId, messageId: { not: null } } });
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!it?.messageId || !deal) return false;
  const found = await graph<{ value: Msg[] }>(`/users/${q(MAILBOX())}/messages?$filter=internetMessageId eq '${it.messageId.replace(/'/g, "''")}'&$select=id,subject,from,receivedDateTime`);
  const msg = found.value[0];
  if (!msg) return false;
  const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  await replyOnThread(msg, replyHtml(deal as unknown as Record<string, unknown>, `${base}/deals/${deal.id}`));
  return true;
}
