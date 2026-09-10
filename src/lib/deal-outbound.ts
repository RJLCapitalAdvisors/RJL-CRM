import { prisma } from "@/lib/db";
import { isSponsorSide } from "@/lib/report-guard";
import { graph } from "@/lib/graph";
import { STAGE_ORDER } from "@/lib/taxonomy";
import { emailHtmlToText } from "@/lib/attachments";

/**
 * A deal email sent by hand from Outlook counts the same as one sent from the Send deal page. When the mailbox
 * sync sees an outbound email that belongs to a deal and goes to an investor or lender, the firm lands on the
 * progress report as "Deal Sent", the deal moves to Deal Taken To Market, and the email's attachments become
 * the ticket's files if it had none. Nothing here touches roles or criteria.
 */

const q = encodeURIComponent;

export async function noteDealSent(opts: { dealId: string; contactId: string | null; companyId: string | null; mailbox: string; graphId: string; hasAttachments: boolean; when: Date; toEmails: string[] }): Promise<boolean> {
  const deal = await prisma.deal.findUnique({ where: { id: opts.dealId }, include: { _count: { select: { files: true } } } });
  if (!deal || !opts.contactId) return false;
  if (opts.companyId && opts.companyId === deal.sponsorCompanyId) return false; // to the sponsor: not a send
  const contact = await prisma.contact.findUnique({ where: { id: opts.contactId }, include: { company: { select: { id: true, roles: true, domain: true } } } });
  if (!contact) return false;
  const roles = contact.company?.roles ?? "";
  if (!/Investor|Lender/i.test(roles)) return false; // only capital sources go on the report

  // the row: this person, Deal Sent, with the others at the firm who were on the To line
  const others = opts.toEmails.filter((e) => e.toLowerCase() !== contact.email?.toLowerCase());
  const extra = others.length ? await prisma.contact.findMany({ where: { email: { in: others.map((e) => e.toLowerCase()) }, companyId: contact.companyId ?? undefined }, select: { id: true } }) : [];
  const existing = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: deal.id, contactId: contact.id } } });
  const firmRow = existing ?? (contact.companyId ? await prisma.dealInvestor.findFirst({ where: { dealId: deal.id, contact: { companyId: contact.companyId } }, orderBy: { createdAt: "asc" } }) : null);
  if (!existing && firmRow) {
    // the firm is already on the report under a colleague: this person joins that row
    const ids = new Set<string>(firmRow.extraContactIds ? (JSON.parse(firmRow.extraContactIds) as string[]) : []);
    ids.add(contact.id);
    for (const x of extra) ids.add(x.id);
    ids.delete(firmRow.contactId);
    const followedUp = firmRow.status === 2 && opts.when.getTime() - firmRow.updatedAt.getTime() > 60 * 60_000;
    await prisma.dealInvestor.update({ where: { id: firmRow.id }, data: { extraContactIds: JSON.stringify([...ids]), status: followedUp ? 3 : Math.max(firmRow.status, 2), ...(firmRow.status < 2 || followedUp ? { sendDraftId: null, sendMailbox: null, sendDraftAt: null, updatedAt: opts.when } : {}) } });
  } else if (!existing) {
    if (!(await isSponsorSide(deal.id, contact.id))) await prisma.dealInvestor.create({ data: { dealId: deal.id, contactId: contact.id, status: 2, extraContactIds: extra.length ? JSON.stringify(extra.map((x) => x.id)) : null, updatedAt: opts.when } });
  } else if (existing.status < 2) {
    await prisma.dealInvestor.update({ where: { id: existing.id }, data: { status: 2, sendDraftId: null, sendMailbox: null, sendDraftAt: null, updatedAt: opts.when } });
  } else if (existing.status === 2 && opts.when.getTime() - existing.updatedAt.getTime() > 60 * 60_000) {
    // a second email from us to a firm that has not answered, an hour or more after the send: we followed up
    await prisma.dealInvestor.update({ where: { id: existing.id }, data: { status: 3, followUpDismissedAt: null, updatedAt: opts.when } });
  }

  // the deal is on the market
  if (STAGE_ORDER.indexOf(deal.stage) < STAGE_ORDER.indexOf("Deal Taken To Market")) await prisma.deal.update({ where: { id: deal.id }, data: { stage: "Deal Taken To Market" } });

  // the OM / model that went out become the ticket's files, and its text fills blanks, when the ticket has none
  if (deal._count.files === 0 && opts.hasAttachments) {
    const { recordDealFiles, mergeIntoDeal, extractDealFacts } = await import("@/lib/deal-knowledge");
    await recordDealFiles(deal.id, opts.mailbox, opts.graphId, opts.mailbox, opts.when).catch(() => 0);
    if (!deal.summary) {
      try {
        const m = await graph<{ subject: string | null; body?: { contentType: string; content: string } }>(`/users/${q(opts.mailbox)}/messages/${q(opts.graphId)}?$select=subject,body`);
        const text = m.body?.contentType === "html" ? emailHtmlToText(m.body.content) : (m.body?.content ?? "");
        if (text.length > 200) {
          await mergeIntoDeal(deal.id, text, m.subject ?? "");
          await extractDealFacts(deal.id, text, `${m.subject ?? "deal email"} (${opts.when.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`);
        }
      } catch {
        /* the ticket keeps what it has */
      }
    }
  }
  return true;
}

/**
 * Catch up: outbound emails logged in the last N days that the sync could not tie to a deal at the time
 * (the matcher has learned house-style subjects since). Re-resolves them and runs the Deal Sent logic.
 */
export async function relinkRecentOutbound(days = 30): Promise<{ linked: number; rows: number }> {
  const { dealResolver } = await import("@/lib/mail-sync");
  const dealFor = await dealResolver();
  const since = new Date(Date.now() - days * 86_400_000);
  const acts = await prisma.activity.findMany({ where: { type: "EMAIL", direction: "OUTBOUND", dealId: null, occurredAt: { gte: since }, contactId: { not: null } }, orderBy: { occurredAt: "asc" } });
  let linked = 0, rows = 0;
  for (const a of acts) {
    const dealId = dealFor(a.subject ?? "", a.contactId, a.companyId);
    if (!dealId) continue;
    await prisma.activity.update({ where: { id: a.id }, data: { dealId } });
    linked++;
    const meta = a.meta ? (JSON.parse(a.meta) as { mailbox?: string; to?: { address: string }[]; hasAttachments?: boolean; graphId?: string }) : {};
    if (!meta.mailbox) continue;
    // the Graph id is not stored on the activity: look the message up by its Message-ID
    const found = a.externalId ? await graph<{ value: { id: string }[] }>(`/users/${q(meta.mailbox)}/messages?$filter=internetMessageId eq '${a.externalId.replace(/'/g, "''")}'&$select=id`).catch(() => ({ value: [] })) : { value: [] };
    const graphId = found.value[0]?.id;
    if (!graphId) continue;
    if (await noteDealSent({ dealId, contactId: a.contactId, companyId: a.companyId, mailbox: meta.mailbox, graphId, hasAttachments: meta.hasAttachments ?? false, when: a.occurredAt, toEmails: (meta.to ?? []).map((t) => t.address) }).catch(() => false)) rows++;
  }
  return { linked, rows };
}
