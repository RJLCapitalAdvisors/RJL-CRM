import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
import { assembleDealText, attachmentToText, emailHtmlToText } from "@/lib/attachments";
import { missingFor, itemLabel } from "@/lib/checklist";
import { intro, metricsHtml, subjectLine } from "@/lib/deal-copy";
import { processIntake } from "@/app/intake/actions";
import { applyForwarderInstructions } from "@/lib/forwarder-notes";
import { detectMultipleDeals, extractDealFacts, matchExistingDeal, mergeIntoDeal, recordDealEmail, recordDealFiles, recordLinkFiles } from "@/lib/deal-knowledge";
import { fetchCloudFiles, findCloudLinks } from "@/lib/cloud-links";

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

function replyHtml(deal: Record<string, unknown>, dealUrl: string, linkNotes: string[] = []): string {
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
${linkNotes.length ? `<p><b>Links I could not open</b></p><ul style="margin:0 0 10pt 18pt;">${linkNotes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
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
  const msg = await graph<Msg>(`/users/${q(MAILBOX())}/messages/${q(messageId)}?$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,isRead,from,body,conversationId`);
  const ext = msg.internetMessageId ?? msg.id;
  if (await prisma.dealIntake.findUnique({ where: { messageId: ext } })) return { skipped: "already processed" };
  const fromAddr = msg.from?.emailAddress.address?.toLowerCase() ?? "";
  if (fromAddr === MAILBOX().toLowerCase()) return { skipped: "our own reply" };

  const bodyText = msg.body?.contentType === "html" ? emailHtmlToText(msg.body.content) : (msg.body?.content ?? "");
  const { names, texts } = msg.hasAttachments ? await readAttachments(msg.id) : { names: [], texts: [] };
  // Drive / Dropbox / OneDrive / Box links in the email: their documents count as attachments
  const cloud = await fetchCloudFiles(findCloudLinks(msg.body?.content, bodyText)).catch(() => ({ files: [], notes: [] as string[] }));
  for (const f of cloud.files) {
    if (names.some((n) => n.toLowerCase() === f.name.toLowerCase())) continue;
    names.push(f.name);
    const text = await attachmentToText(f.name, f.contentType, f.bytes).catch(() => null);
    if (text) texts.push({ name: f.name, text });
  }
  const linkFiles = cloud.files.map((f) => ({ name: f.name, contentType: f.contentType, size: f.size, url: f.url, source: f.source }));
  const rawText = assembleDealText(bodyText, texts);
  const fwd = forwardedSender(bodyText);
  const external = !INTERNAL.test(fromAddr);
  const cleanSubject = (msg.subject ?? "").replace(/^\s*((fw|fwd|re):\s*)+/i, "");
  const received = new Date(msg.receivedDateTime ?? Date.now());
  // keep the pulled documents on a message in deals@ ("CRM Files"), so they serve and send like any attachment
  const { stashFiles } = await import("@/lib/file-store");
  const stashes = cloud.files.length ? await stashFiles(cloud.files, cleanSubject || "deal files").catch((e) => { console.error("stash failed", e); return []; }) : [];
  const recordPulled = async (dealId: string, messageKey: string, only?: string[]) => {
    const keep = (n: string) => !only || only.some((x) => x.toLowerCase() === n.toLowerCase());
    if (stashes.length) {
      let n = 0;
      for (const st of stashes) n += await recordDealFiles(dealId, st.mailbox, st.graphId, external ? fromAddr : fwd.email, received, st.atts.filter((a) => keep(a.name))).catch(() => 0);
      return n;
    }
    return recordLinkFiles(dealId, messageKey, linkFiles.filter((f) => keep(f.name)), external ? fromAddr : fwd.email, received).catch(() => 0);
  };

  // Is this about a deal we already have? Then it is a follow-up: files and answers join that ticket.
  const existingId = await matchExistingDeal({ conversationId: (msg as Msg & { conversationId?: string }).conversationId ?? null, subject: cleanSubject, bodyText, senderEmail: external ? fromAddr : fwd.email, attachmentNames: names, attachmentText: texts.map((t) => `=== ${t.name} ===\n${t.text.slice(0, 1500)}`).join("\n") });
  if (existingId) {
    await recordDealEmail(existingId, { messageId: ext, graphId: msg.id, conversationId: (msg as Msg & { conversationId?: string }).conversationId ?? null, subject: msg.subject, fromEmail: external ? fromAddr : fwd.email, receivedAt: received, kind: "FOLLOWUP" });
    const files = (msg.hasAttachments ? await recordDealFiles(existingId, MAILBOX(), msg.id, external ? fromAddr : fwd.email, received).catch(() => 0) : 0) + (await recordPulled(existingId, ext));
    const facts = await extractDealFacts(existingId, rawText, `${cleanSubject} (${received.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`).catch(() => 0);
    const filled = await mergeIntoDeal(existingId, rawText, cleanSubject).catch(() => 0);
    if (!external) await applyForwarderInstructions(existingId, bodyText).catch(() => null);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: existingId } });
    const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
    const still = missingFor(deal).map((it) => itemLabel(it, deal.strategy));
    let replied = false;
    try {
      await replyOnThread(msg, followUpReplyHtml(deal.propertyName ?? deal.name, `${base}/deals/${deal.id}`, files, facts, filled, still, cloud.notes));
      replied = true;
    } catch (e) {
      console.error("deals@ follow-up reply failed", e);
    }
    await prisma.dealIntake.create({ data: { source: "WEBHOOK", fromEmail: external ? fromAddr : fwd.email, fromName: external ? msg.from?.emailAddress.name ?? null : fwd.name, toEmail: MAILBOX(), subject: msg.subject, rawText: rawText.slice(0, 200_000), attachments: JSON.stringify(names), extracted: "{}", missing: "[]", notes: `Follow-up on existing deal ${existingId}`, status: "CONVERTED", messageId: ext } }).catch(() => null);
    await graph(`/users/${q(MAILBOX())}/messages/${q(msg.id)}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => {});
    return { dealId: existingId, replied };
  }

  // Several deals in one email? One ticket each, with only its own files.
  const parts = msg.hasAttachments || bodyText.length > 400 ? await detectMultipleDeals(bodyText, names, texts).catch(() => []) : [];
  if (parts.length > 1) {
    const created: { id: string; name: string }[] = [];
    for (const [i, part] of parts.entries()) {
      const own = texts.filter((t) => part.attachments.some((n) => n.toLowerCase() === t.name.toLowerCase()));
      const text = assembleDealText(`THIS EMAIL CONTAINS ${parts.length} DEALS. Extract ONLY the deal "${part.name}" (${part.hint}). Ignore the others.\n\n${bodyText}`, own.length ? own : []);
      const intakeN = await processIntake({ rawText: text, subject: `${cleanSubject} - ${part.name}`, fromName: external ? msg.from?.emailAddress.name ?? null : fwd.name, fromEmail: external ? fromAddr : fwd.email, toEmail: MAILBOX(), source: "WEBHOOK", attachments: own.map((t) => t.name) });
      const key = i === 0 ? ext : `${ext}#${i + 1}`;
      await prisma.dealIntake.update({ where: { id: intakeN.id }, data: { messageId: key } }).catch(() => null);
      await recordDealEmail(intakeN.dealId, { messageId: key, graphId: msg.id, conversationId: (msg as Msg & { conversationId?: string }).conversationId ?? null, subject: msg.subject, fromEmail: external ? fromAddr : fwd.email, receivedAt: received, kind: "INTAKE" }).catch(() => null);
      if (msg.hasAttachments) {
        const all = await graph<{ value: Att[] }>(`/users/${q(MAILBOX())}/messages/${q(msg.id)}/attachments?$select=id,name,contentType,size,isInline`).catch(() => ({ value: [] as Att[] }));
        const mine = all.value.filter((a) => part.attachments.some((n) => n.toLowerCase() === a.name.toLowerCase()));
        await recordDealFiles(intakeN.dealId, MAILBOX(), msg.id, external ? fromAddr : fwd.email, received, mine as never).catch(() => 0);
      }
      await recordPulled(intakeN.dealId, key, part.attachments);
      await extractDealFacts(intakeN.dealId, text, `${cleanSubject} (${received.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`).catch(() => 0);
      const owner = fromAddr ? await prisma.user.findFirst({ where: { email: { equals: fromAddr, mode: "insensitive" } } }) : null;
      if (owner) await prisma.deal.update({ where: { id: intakeN.dealId }, data: { ownerId: owner.id } });
      if (!external) await applyForwarderInstructions(intakeN.dealId, bodyText).catch(() => null);
      const dl = await prisma.deal.findUniqueOrThrow({ where: { id: intakeN.dealId } });
      created.push({ id: dl.id, name: dl.propertyName ?? dl.name });
    }
    const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
    let replied = false;
    try {
      const sections: string[] = [];
      for (const c of created) {
        const dl = await prisma.deal.findUniqueOrThrow({ where: { id: c.id } });
        sections.push(replyHtml(dl as unknown as Record<string, unknown>, `${base}/deals/${dl.id}`, sections.length === 0 ? cloud.notes : []));
      }
      await replyOnThread(msg, `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;"><p style="margin:0 0 12pt 0;">This email carried ${created.length} deals; a ticket was created for each.</p>${sections.join('<hr style="border:0;border-top:1px solid #ddd;margin:16pt 0;">')}</div>`);
      replied = true;
    } catch (e) {
      console.error("deals@ multi reply failed", e);
    }
    await graph(`/users/${q(MAILBOX())}/messages/${q(msg.id)}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => {});
    return { dealId: created[0].id, replied };
  }

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
  await recordDealEmail(intake.dealId, { messageId: ext, graphId: msg.id, conversationId: (msg as Msg & { conversationId?: string }).conversationId ?? null, subject: msg.subject, fromEmail: external ? fromAddr : fwd.email, receivedAt: received, kind: "INTAKE" }).catch(() => null);
  if (msg.hasAttachments) await recordDealFiles(intake.dealId, MAILBOX(), msg.id, external ? fromAddr : fwd.email, received).catch(() => 0);
  await recordPulled(intake.dealId, ext);
  await extractDealFacts(intake.dealId, rawText, `${cleanSubject} (${received.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`).catch(() => 0);
  // whoever forwarded it to deals@ owns the deal
  const owner = fromAddr ? await prisma.user.findFirst({ where: { email: { equals: fromAddr, mode: "insensitive" } } }) : null;
  if (owner) await prisma.deal.update({ where: { id: intake.dealId }, data: { ownerId: owner.id } });

  // anything the teammate wrote above the forwarded email is an instruction: stage, investors already introduced, notes
  if (!external) await applyForwarderInstructions(intake.dealId, bodyText).catch((e) => console.error("forwarder instructions", e));

  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: intake.dealId } });
  const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  let replied = false;
  try {
    await replyOnThread(msg, replyHtml(deal as unknown as Record<string, unknown>, `${base}/deals/${deal.id}`, cloud.notes));
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
  if (!notificationUrl.startsWith("https://")) return "skipped: Graph only notifies https URLs (APP_URL is local)";
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


function followUpReplyHtml(name: string, link: string, files: number, facts: number, filled: number, still: string[], linkNotes: string[] = []) {
  const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const li = (s: string) => `<li style="margin:0;${F}">${s}</li>`;
  return `<div style="${F}">
<p style="margin:0 0 10pt 0;${F}">Added to <a href="${link}">${name}</a>: ${files} file${files === 1 ? "" : "s"} to Attachments, ${facts} answer${facts === 1 ? "" : "s"} to Questions answered${filled ? `, ${filled} ticket field${filled === 1 ? "" : "s"} filled in` : ""}.</p>
${still.length ? `<p style="margin:0 0 4pt 0;${F}"><b>Still missing:</b></p><ul style="margin:0 0 10pt 18pt;">${still.map(li).join("")}</ul>` : `<p style="margin:0 0 10pt 0;${F}">Checklist is complete.</p>`}
${linkNotes.length ? `<p style="margin:0 0 4pt 0;${F}"><b>Links I could not open:</b></p><ul style="margin:0 0 10pt 18pt;">${linkNotes.map(li).join("")}</ul>` : ""}
</div>`;
}
