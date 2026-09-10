import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { addAttachment, createDraft, getMessage, graph, graphConfigured, listAttachments, outlookDesktopLink, type GraphAttachment } from "@/lib/graph";
import { signatureFor, type FollowUpResult } from "@/lib/followup";
import { bestContactForCompany } from "@/lib/engagement";
import { renderTemplate, toHtml, type MergeContext } from "@/lib/merge";
import { unsubscribeUrl } from "@/lib/tokens";
import { parseList, toJson, STAGE_ORDER } from "@/lib/taxonomy";
import { logActivity } from "@/lib/activity";

/**
 * From "engagement letter signed" to "deal sent":
 *   finalizeEngagement  the groups the sponsor agreed to become the progress report; stage -> Engagement Letter Signed
 *   createSendDrafts    one Outlook draft per firm from the deal template, personal first line, the deal's own
 *                       attachments re-attached, the chosen people on the To line; stage stays until something is sent
 *   syncSendDrafts      when a draft is actually sent, the row becomes Deal Sent and the deal moves to Deal Taken To Market
 */

export { STAGE_ORDER };
const FONT = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
const DEALS_MAILBOX = () => process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com";

export async function advance(dealId: string, to: string) {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { stage: true } });
  if (d && STAGE_ORDER.indexOf(d.stage) < STAGE_ORDER.indexOf(to)) await prisma.deal.update({ where: { id: dealId }, data: { stage: to } });
}

/** The groups currently on the report, one line per firm. */
export async function engagementGroups(dealId: string) {
  const rows = await prisma.dealInvestor.findMany({ where: { dealId }, include: { contact: { include: { company: { select: { id: true, name: true, domain: true } } } } }, orderBy: { createdAt: "asc" } });
  const byCompany = new Map<string, { companyId: string; name: string; domain: string | null; rowIds: string[]; status: number }>();
  for (const r of rows) {
    const key = r.contact.companyId ?? `contact:${r.contactId}`;
    const g = byCompany.get(key) ?? { companyId: r.contact.companyId ?? "", name: r.contact.company?.name ?? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "), domain: r.contact.company?.domain ?? null, rowIds: [], status: r.status };
    g.rowIds.push(r.id);
    g.status = Math.max(g.status, r.status);
    byCompany.set(key, g);
  }
  return [...byCompany.values()];
}

/** Sponsor agreed to these firms (after redlines): drop the rest that were never sent, add any new ones, mark the letter signed. */
export async function finalizeEngagement(dealId: string, keepCompanyIds: string[], addCompanyIds: string[]) {
  const groups = await engagementGroups(dealId);
  let removed = 0, added = 0;
  for (const g of groups) {
    if (g.companyId && !keepCompanyIds.includes(g.companyId) && g.status <= 1) {
      const r = await prisma.dealInvestor.deleteMany({ where: { id: { in: g.rowIds }, status: 1 } });
      removed += r.count;
    }
  }
  for (const cid of addCompanyIds) {
    const c = await bestContactForCompany(cid);
    if (!c) continue;
    const exists = await prisma.dealInvestor.findFirst({ where: { dealId, contactId: c.id } });
    if (!exists) {
      await prisma.dealInvestor.create({ data: { dealId, contactId: c.id, status: 1 } });
      added++;
    }
  }
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
  const details = JSON.parse(deal.details || "{}") as Record<string, unknown>;
  const agreed = (await engagementGroups(dealId)).map((g) => g.name);
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...details, agreedGroups: agreed, engagementSignedAt: new Date().toISOString() }) } });
  await advance(dealId, "Engagement Letter Signed");
  await logActivity({ type: "NOTE", body: `Engagement letter signed. ${agreed.length} groups agreed${removed ? `, ${removed} removed` : ""}${added ? `, ${added} added` : ""}.`, dealId, companyId: deal.sponsorCompanyId });
  return { agreed: agreed.length, removed, added };
}

// ---------- drafting the deal email ----------

export type SendItem = { rowId: string; toContactIds: string[]; openingLine: string | null; bodyOverride: string | null };
export type SendResult = { rowId: string; firm: string; to: string[]; result: FollowUpResult };

function stripTemplateSignoff(html: string) {
  return html.replace(/<p>\s*\{\{sender\.name\}\}\s*<br\s*\/?>\s*RJL Capital Advisors\s*<\/p>\s*$/i, "").replace(/<p>\s*\{\{sender\.name\}\}\s*<br\s*\/?>\s*RJL Capital Advisors\s*<\/p>/i, "");
}

/** Render subject and HTML body for one recipient, house style, ready for Outlook. */
export async function renderDealEmail(opts: { templateId: string; deal: Record<string, unknown>; contact: { firstName: string | null; lastName: string | null; email: string | null; id: string }; company: { name: string } | null; openingLine: string | null; bodyOverride: string | null; senderName: string; mailbox: string }) {
  const tpl = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: opts.templateId } });
  const ctx: MergeContext = { contact: opts.contact, company: opts.company, deal: opts.deal, sender: { name: opts.senderName }, unsubscribeUrl: unsubscribeUrl(opts.contact.id), openingLine: opts.openingLine };
  const subject = renderTemplate(tpl.subject, ctx);
  const body = renderTemplate(stripTemplateSignoff(opts.bodyOverride ?? tpl.bodyHtml), ctx);
  const html = `<div style="${FONT}">${toHtml(body).replace(/<p>/g, `<p style="margin:0 0 10pt 0;${FONT}">`)}${await signatureFor(opts.mailbox)}</div>`;
  return { subject, html, text: body };
}

export type DealFile = { key: string; mailbox: string; messageId: string; attachmentId: string; name: string; size: number; contentType: string | null; from: string; receivedAt: string; url?: string | null };
const IMAGE = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;
const isModel = (n: string) => /\.(xlsx|xlsm|xls)$/i.test(n);
const isOM = (n: string) => /\.pdf$/i.test(n);

/**
 * Every file the sponsor sent us on this deal: attachments on the forwarded email in deals@ and on any later
 * message in that same thread (sponsor replies with more docs). Images and signature logos are left out.
 */
export const FAQ_KEY = "faq";
/** The generated Investor FAQ appears as a file whenever the ticket has Questions answered. */
async function faqEntry(dealId: string): Promise<DealFile | null> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { propertyName: true, name: true, _count: { select: { facts: { where: { inFaq: true } } } } } });
  if (!deal || deal._count.facts === 0) return null;
  const { faqFileName } = await import("@/lib/faq-pdf");
  return { key: FAQ_KEY, mailbox: "", messageId: "", attachmentId: "", name: faqFileName(deal.propertyName ?? deal.name), size: 0, contentType: "application/pdf", from: "RJL CRM", receivedAt: new Date().toISOString() };
}

export async function dealFiles(dealId: string): Promise<DealFile[]> {
  const faq = await faqEntry(dealId);
  const recorded = await prisma.dealFile.findMany({ where: { dealId }, orderBy: { receivedAt: "desc" } });
  if (recorded.length) {
    const seen = new Set<string>();
    return [...(faq ? [faq] : []), ...recorded
      .filter((f) => (seen.has(f.name.toLowerCase()) ? false : (seen.add(f.name.toLowerCase()), true)))
      .map((f) => ({ key: `${f.graphId}::${f.attachmentId}`, mailbox: f.mailbox, messageId: f.graphId, attachmentId: f.attachmentId, name: f.name, size: f.size, contentType: f.contentType, from: f.fromEmail ?? "", receivedAt: f.receivedAt.toISOString(), url: f.url }))
      .sort((a, b) => Number(isModel(b.name) || isOM(b.name)) - Number(isModel(a.name) || isOM(a.name)))];
  }
  const it = await prisma.dealIntake.findFirst({ where: { dealId, messageId: { not: null } } });
  if (!it?.messageId || !graphConfigured()) return [];
  const q = encodeURIComponent;
  const mb = DEALS_MAILBOX();
  const found = await graph<{ value: { id: string; conversationId?: string }[] }>(`/users/${q(mb)}/messages?$filter=internetMessageId eq '${it.messageId.replace(/'/g, "''")}'&$select=id,conversationId`);
  const first = found.value[0];
  if (!first) return [];
  let msgs: { id: string; from?: { emailAddress: { address: string } }; receivedDateTime?: string; hasAttachments?: boolean }[] = [];
  if (first.conversationId) {
    const r = await graph<{ value: typeof msgs }>(`/users/${q(mb)}/messages?$filter=conversationId eq '${first.conversationId.replace(/'/g, "''")}'&$select=id,from,receivedDateTime,hasAttachments&$top=50`).catch(() => ({ value: [] as typeof msgs }));
    msgs = r.value;
  }
  if (!msgs.some((m) => m.id === first.id)) msgs.unshift({ id: first.id, hasAttachments: true });
  const out: DealFile[] = [];
  for (const m of msgs) {
    if (m.hasAttachments === false) continue;
    if (m.from?.emailAddress.address?.toLowerCase() === mb.toLowerCase()) continue; // our own summary replies
    const atts = await listAttachments(mb, m.id).catch(() => [] as GraphAttachment[]);
    for (const a of atts) {
      if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment" || IMAGE.test(a.name)) continue;
      out.push({ key: `${m.id}::${a.id}`, mailbox: mb, messageId: m.id, attachmentId: a.id, name: a.name, size: a.size, contentType: a.contentType, from: m.from?.emailAddress.address ?? "", receivedAt: m.receivedDateTime ?? "" });
    }
  }
  // newest copy of a same-named file wins; models and OMs first
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .filter((f) => (seen.has(f.name.toLowerCase()) ? false : (seen.add(f.name.toLowerCase()), true)))
    .sort((a, b) => Number(isModel(b.name) || isOM(b.name)) - Number(isModel(a.name) || isOM(a.name)));
}

/** Who we usually write to at a firm: anyone on 40%+ of our outbound emails there in the last year (at least the most frequent). */
export async function usualRecipients(companyId: string, candidates: { id: string; email: string | null }[]): Promise<string[]> {
  const acts = await prisma.activity.findMany({ where: { companyId, type: "EMAIL", direction: "OUTBOUND", occurredAt: { gte: new Date(Date.now() - 365 * 86_400_000) } }, select: { meta: true }, take: 500 });
  const tally = new Map<string, number>();
  for (const a of acts) {
    const meta = a.meta ? (JSON.parse(a.meta) as { to?: { address: string }[]; cc?: { address: string }[] }) : {};
    for (const p of [...(meta.to ?? []), ...(meta.cc ?? [])]) tally.set(p.address.toLowerCase(), (tally.get(p.address.toLowerCase()) ?? 0) + 1);
  }
  const scored = candidates.filter((c) => c.email).map((c) => ({ id: c.id, n: tally.get(c.email!.toLowerCase()) ?? 0 })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return [];
  const top = scored[0].n;
  return scored.filter((c) => c.n >= Math.max(1, top * 0.4)).map((c) => c.id);
}

/** The deal's own files: whatever came attached to the forwarded email in deals@. */
async function dealAttachments(dealId: string): Promise<{ mailbox: string; messageId: string; atts: GraphAttachment[] } | null> {
  const it = await prisma.dealIntake.findFirst({ where: { dealId, messageId: { not: null } } });
  if (!it?.messageId) return null;
  const found = await graph<{ value: { id: string }[] }>(`/users/${encodeURIComponent(DEALS_MAILBOX())}/messages?$filter=internetMessageId eq '${it.messageId.replace(/'/g, "''")}'&$select=id`);
  const msg = found.value[0];
  if (!msg) return null;
  const atts = (await listAttachments(DEALS_MAILBOX(), msg.id)).filter((a) => !a.isInline && a["@odata.type"] === "#microsoft.graph.fileAttachment");
  return { mailbox: DEALS_MAILBOX(), messageId: msg.id, atts };
}

async function copyAcross(src: { mailbox: string; messageId: string }, att: GraphAttachment & { _bytes?: Uint8Array }, dstMailbox: string, dstMessageId: string) {
  const q = encodeURIComponent;
  const bytes = att._bytes ?? new Uint8Array(await graph<ArrayBuffer>(`/users/${q(src.mailbox)}/messages/${q(src.messageId)}/attachments/${q(att.id)}/$value`, { raw: true }));
  await addAttachment(dstMailbox, dstMessageId, { name: att.name, contentType: att.contentType ?? "application/octet-stream", bytes });
}

export async function createSendDrafts(dealId: string, templateId: string, items: SendItem[], mailbox: string, senderName: string): Promise<SendResult[]> {
  if (!graphConfigured()) return items.map((i) => ({ rowId: i.rowId, firm: "", to: [], result: { ok: false, reason: "Microsoft 365 is not connected" } }));
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
  const src = await dealAttachments(dealId).catch(() => null);
  const out: SendResult[] = [];
  for (const item of items) {
    const row = await prisma.dealInvestor.findUnique({ where: { id: item.rowId }, include: { contact: { include: { company: true } } } });
    if (!row) continue;
    const people = await prisma.contact.findMany({ where: { id: { in: item.toContactIds.length ? item.toContactIds : [row.contactId] }, email: { not: null } } });
    const firm = row.contact.company?.name ?? "";
    if (!people.length) {
      out.push({ rowId: row.id, firm, to: [], result: { ok: false, reason: "No email address for anyone picked" } });
      continue;
    }
    try {
      // reuse an unsent draft from an earlier pass instead of piling up duplicates
      if (row.sendDraftId && row.sendMailbox) {
        const d = await getMessage(row.sendMailbox, row.sendDraftId, "id,isDraft,webLink,internetMessageId").catch(() => null);
        if (d?.isDraft) {
          out.push({ rowId: row.id, firm, to: people.map((p) => p.email!), result: { ok: true, webLink: d.webLink ?? "", outlookLink: await outlookDesktopLink(row.sendMailbox, d.id), messageId: d.internetMessageId ?? null, mode: "new", attachments: 0 } });
          continue;
        }
      }
      const primary = people.find((p) => p.id === row.contactId) ?? people[0];
      const { subject, html } = await renderDealEmail({ templateId, deal: deal as unknown as Record<string, unknown>, contact: primary, company: row.contact.company, openingLine: item.openingLine, bodyOverride: item.bodyOverride, senderName, mailbox });
      const draft = await createDraft(mailbox, { subject, toRecipients: people.map((p) => p.email!), bodyHtml: `<html><body>${html}</body></html>` });
      let attachments = 0;
      if (src) for (const a of src.atts) { await copyAcross(src, a, mailbox, draft.id); attachments++; }
      const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
      await prisma.dealInvestor.update({ where: { id: row.id }, data: { openingLine: item.openingLine, bodyOverride: item.bodyOverride, extraContactIds: toJson(people.map((p) => p.id).filter((id) => id !== row.contactId)), sendDraftId: draft.id, sendMailbox: mailbox, sendDraftAt: new Date(), updatedAt: row.updatedAt } });
      out.push({ rowId: row.id, firm, to: people.map((p) => p.email!), result: { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new", attachments } });
    } catch (e) {
      out.push({ rowId: row.id, firm, to: people.map((p) => p.email!), result: { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 200) } });
    }
  }
  return out;
}

/** Drafts that went out: Deal Sent, deal to market, email logged. */
export async function syncSendDrafts(): Promise<number> {
  if (!graphConfigured()) return 0;
  const rows = await prisma.dealInvestor.findMany({ where: { sendDraftId: { not: null } }, include: { contact: { select: { companyId: true } } } });
  let sent = 0;
  for (const r of rows) {
    try {
      const m = await getMessage(r.sendMailbox!, r.sendDraftId!, "id,isDraft,sentDateTime,subject");
      if (m.isDraft) continue;
      const when = m.sentDateTime ? new Date(m.sentDateTime) : new Date();
      await prisma.dealInvestor.update({ where: { id: r.id }, data: { status: Math.max(r.status, 2), sendDraftId: null, sendMailbox: null, sendDraftAt: null, updatedAt: when } });
      await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: m.subject ?? "Deal email", body: "Deal email sent from Outlook (Send deal)", contactId: r.contactId, companyId: r.contact.companyId, dealId: r.dealId, occurredAt: when });
      for (const extra of parseList(r.extraContactIds)) await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: m.subject ?? "Deal email", body: "Deal email sent from Outlook (Send deal)", contactId: extra, dealId: r.dealId, occurredAt: when }).catch(() => {});
      await advance(r.dealId, "Deal Taken To Market");
      sent++;
    } catch (e) {
      if (String(e).includes("404")) await prisma.dealInvestor.update({ where: { id: r.id }, data: { sendDraftId: null, sendMailbox: null, sendDraftAt: null } });
    }
  }
  return sent;
}

export type LaunchItem = { rowId: string; toContactIds: string[]; subject: string; html: string; cc?: string[] };
type Src = Awaited<ReturnType<typeof dealAttachments>>;
export async function chosenFiles(dealId: string, keys: string[] | undefined): Promise<Src> {
  if (!keys) return dealAttachments(dealId).catch(() => null); // no choice made: everything the sponsor sent
  const files = (await dealFiles(dealId)).filter((f) => keys.includes(f.key));
  if (!files.length) return null;
  const atts: (GraphAttachment & { _msg?: string; _bytes?: Uint8Array })[] = [];
  for (const f of files) {
    if (f.key === FAQ_KEY) {
      const { buildFaqPdf } = await import("@/lib/faq-pdf");
      const pdf = await buildFaqPdf(dealId);
      if (pdf) atts.push({ "@odata.type": "#microsoft.graph.fileAttachment", id: FAQ_KEY, name: pdf.name, contentType: "application/pdf", size: pdf.bytes.byteLength, isInline: false, _bytes: pdf.bytes });
      continue;
    }
    if (f.url) {
      const { fetchCloudFileByUrl } = await import("@/lib/cloud-links");
      const bytes = await fetchCloudFileByUrl(f.url, f.name).catch(() => null);
      if (bytes) atts.push({ "@odata.type": "#microsoft.graph.fileAttachment", id: f.attachmentId, name: f.name, contentType: f.contentType, size: bytes.byteLength, isInline: false, _bytes: bytes });
      continue;
    }
    atts.push({ "@odata.type": "#microsoft.graph.fileAttachment", id: f.attachmentId, name: f.name, contentType: f.contentType, size: f.size, isInline: false, _msg: f.messageId });
  }
  const anchor = files.find((f) => f.key !== FAQ_KEY && !f.url) ?? files.find((f) => f.key !== FAQ_KEY) ?? files[0];
  return { mailbox: anchor.mailbox || DEALS_MAILBOX(), messageId: anchor.messageId, atts };
}
export type LaunchResult = { rowId: string; firm: string; to: string[]; ok: boolean; error?: string };

/** Build a message in the sender's mailbox with the deal's attachments and send it. */
export async function sendMessage(mailbox: string, to: string[], subject: string, html: string, src: Src, cc: string[] = []) {
  const draft = await createDraft(mailbox, { subject, toRecipients: to, ccRecipients: cc.filter((c) => c && !to.some((t) => t.toLowerCase() === c.toLowerCase())), bodyHtml: `<html><body>${html}</body></html>` });
  if (src) for (const a of src.atts) await copyAcross({ mailbox: src.mailbox, messageId: (a as GraphAttachment & { _msg?: string })._msg ?? src.messageId }, a, mailbox, draft.id);
  const fresh = await getMessage(mailbox, draft.id, "id,internetMessageId");
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
  return fresh.internetMessageId ?? null;
}

/** LAUNCH: every firm gets its own edited email, all sent now. Rows flip to Deal Sent; the deal goes to market. */
const PACE_MS = 1500; // a human sends one email at a time; a burst of thirty identical emails in two seconds looks like bulk mail

export async function launchDealEmails(dealId: string, items: LaunchItem[], mailbox: string, fileKeys?: string[]): Promise<LaunchResult[]> {
  if (!graphConfigured()) return items.map((i) => ({ rowId: i.rowId, firm: "", to: [], ok: false, error: "Microsoft 365 is not connected" }));
  const src = await chosenFiles(dealId, fileKeys);
  const out: LaunchResult[] = [];
  let sentSoFar = 0;
  for (const item of items) {
    if (sentSoFar > 0) await new Promise((r) => setTimeout(r, PACE_MS + Math.floor(Math.random() * 700)));
    sentSoFar++;
    const row = await prisma.dealInvestor.findUnique({ where: { id: item.rowId }, include: { contact: { include: { company: true } } } });
    if (!row) continue;
    const firm = row.contact.company?.name ?? "";
    const people = await prisma.contact.findMany({ where: { id: { in: item.toContactIds.length ? item.toContactIds : [row.contactId] }, email: { not: null } } });
    const to = people.map((p) => p.email!);
    if (!to.length) {
      out.push({ rowId: row.id, firm, to, ok: false, error: "nobody with an email picked" });
      continue;
    }
    try {
      const messageId = await sendMessage(mailbox, to, item.subject, item.html, src, item.cc ?? []);
      const now = new Date();
      await prisma.dealInvestor.update({ where: { id: row.id }, data: { status: Math.max(row.status, 2), bodyOverride: item.html, extraContactIds: toJson(people.map((p) => p.id).filter((id) => id !== row.contactId)), sendDraftId: null, sendMailbox: null, sendDraftAt: null, updatedAt: now } });
      for (const p of people) await logActivity({ type: "EMAIL", direction: "OUTBOUND", subject: item.subject, body: "Deal email sent (Send deal)", externalId: p.id === people[0].id ? messageId : null, contactId: p.id, companyId: row.contact.companyId, dealId, occurredAt: now }).catch(() => {});
      out.push({ rowId: row.id, firm, to, ok: true });
    } catch (e) {
      out.push({ rowId: row.id, firm, to, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }
  if (out.some((r) => r.ok)) await advance(dealId, "Deal Taken To Market");
  return out;
}

/** "Send preview email": the exact email for one firm, delivered to the sender instead. */
export async function sendPreviewToSelf(dealId: string, item: LaunchItem, mailbox: string, fileKeys?: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!graphConfigured()) return { ok: false, error: "Microsoft 365 is not connected" };
  try {
    const src = await chosenFiles(dealId, fileKeys);
    await sendMessage(mailbox, [mailbox], `[PREVIEW] ${item.subject}`, item.html, src);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

// ---------- the General email: one version for everyone, and edits asked of the CRM ----------

/** The deal email with no one's name in it: the starting point every firm's email derives from. */
export async function renderGeneralDealEmail(opts: { templateId: string; dealId: string; senderName: string; mailbox: string }) {
  const { FIRST_NAME_MARKER } = await import("@/lib/first-name-marker");
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: opts.dealId } });
  return renderDealEmail({ templateId: opts.templateId, deal: deal as unknown as Record<string, unknown>, contact: { firstName: FIRST_NAME_MARKER, lastName: "", email: "", id: "" }, company: null, openingLine: "hope you are well.", bodyOverride: null, senderName: opts.senderName, mailbox: opts.mailbox });
}

const Revised = z.object({ subject: z.string().describe("The subject line, unchanged unless the request was about it."), html: z.string().describe("The full email HTML after the change.") });

/** Apply a plain-English request ("emphasize the business plan more") to the email; everything else stays as it was. */
export async function reviseDealEmail(opts: { dealId: string; subject: string; html: string; instruction: string }): Promise<{ subject: string; html: string } | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "Claude is not configured." };
  const deal = await prisma.deal.findUnique({ where: { id: opts.dealId }, include: { facts: { orderBy: { createdAt: "desc" }, take: 40 } } });
  const facts = deal?.facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n") ?? "";
  try {
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 6000,
      system: [
        "You edit an outbound deal email for RJL Capital Advisors, a real estate capital advisor emailing institutional investors. Apply the requested change and nothing else.",
        "Keep: the HTML structure and inline styles, the greeting line with its empty <span data-first-name> placeholder, the bold lead-ins, the signature block at the end (verbatim), and every fact and number. Never invent figures; if the request needs information you do not have, work with what is in the email and the deal notes.",
        "Tone: concise, direct, professional, one-to-one (not a blast). Return the complete email HTML.",
      ].join(" "),
      messages: [{ role: "user", content: ["REQUEST:", opts.instruction.trim(), "", "SUBJECT:", opts.subject, "", "EMAIL HTML:", opts.html, "", "DEAL NOTES (Questions answered on the ticket, for reference):", facts || "(none)"].join("\n") }],
      output_config: { format: zodOutputFormat(Revised) },
    });
    const out = res.parsed_output;
    if (!out?.html) return { error: "No revision came back." };
    return { subject: out.subject || opts.subject, html: out.html };
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

// ---------- one person, after launch: an LP on a call asks to see the deal ----------

/**
 * Draft the deal email to a single contact in the sender's Outlook, attachments included, ready to send.
 * Uses the General email saved on the Send deal page (with this person's first name) when there is one, else the
 * house template; attaches the files chosen there, else the usual first six. The person joins the progress report
 * as Deal Not Sent and flips to Deal Sent once the draft leaves Drafts (syncSendDrafts).
 */
export async function draftDealToOne(dealId: string, contactId: string, mailbox: string, senderName: string): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const [deal, contact] = await Promise.all([prisma.deal.findUniqueOrThrow({ where: { id: dealId } }), prisma.contact.findUniqueOrThrow({ where: { id: contactId }, include: { company: true } })]);
  if (!contact.email) return { ok: false, reason: `${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "This contact"} has no email address on file` };

  const row = await prisma.dealInvestor.upsert({ where: { dealId_contactId: { dealId, contactId } }, create: { dealId, contactId, status: 1 }, update: {} });
  if (row.sendDraftId && row.sendMailbox) {
    const d = await getMessage(row.sendMailbox, row.sendDraftId, "id,isDraft,webLink,internetMessageId").catch(() => null);
    if (d?.isDraft) return { ok: true, webLink: d.webLink ?? "", outlookLink: await outlookDesktopLink(row.sendMailbox, d.id), messageId: d.internetMessageId ?? null, mode: "new", attachments: 0 };
  }

  let state: { templateId?: string; general?: { subject: string; html: string } | null; chosenFiles?: string[] } = {};
  try {
    state = (JSON.parse(deal.details || "{}") as { sendState?: typeof state }).sendState ?? {};
  } catch {
    /* no saved send state */
  }
  let subject: string, html: string;
  if (state.general?.html) {
    const { withFirstName } = await import("@/lib/first-name-marker");
    subject = state.general.subject;
    html = withFirstName(state.general.html, contact.firstName);
  } else {
    const templates = await prisma.emailTemplate.findMany({ where: { kind: "DEAL", NOT: { name: { contains: "Engagement" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const tpl = (state.templateId && templates.find((t) => t.id === state.templateId)) || templates.find((t) => t.name.startsWith("Deal email (house")) || templates[0];
    if (!tpl) return { ok: false, reason: "No deal email template on file" };
    const r = await renderDealEmail({ templateId: tpl.id, deal: deal as unknown as Record<string, unknown>, contact, company: contact.company, openingLine: null, bodyOverride: null, senderName, mailbox });
    subject = r.subject;
    html = r.html;
  }
  const keys = state.chosenFiles ?? (await dealFiles(dealId).catch(() => [])).slice(0, 6).map((f) => f.key);
  try {
    const src = await chosenFiles(dealId, keys);
    const draft = await createDraft(mailbox, { subject, toRecipients: [contact.email], bodyHtml: `<html><body>${html}</body></html>` });
    let attachments = 0;
    if (src) for (const a of src.atts) { await copyAcross({ mailbox: src.mailbox, messageId: (a as GraphAttachment & { _msg?: string })._msg ?? src.messageId }, a, mailbox, draft.id); attachments++; }
    const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
    await prisma.dealInvestor.update({ where: { id: row.id }, data: { sendDraftId: draft.id, sendMailbox: mailbox, sendDraftAt: new Date(), bodyOverride: html, updatedAt: row.updatedAt } });
    return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new", attachments };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
