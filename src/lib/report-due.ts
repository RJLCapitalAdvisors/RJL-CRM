import { prisma } from "@/lib/db";
import { addAttachment, createDraft, createReplyAllDraft, getMessage, graphConfigured, outlookDesktopLink, sentMessagesTo, updateDraftBody } from "@/lib/graph";
import { signatureFor, type FollowUpResult } from "@/lib/followup";
import { sponsorContactsFor } from "@/lib/engagement";
import { sponsorThreadFor } from "@/lib/sponsor-thread";
import { buildProgressReportPdf } from "@/lib/progress-report-pdf";

/**
 * Progress reports go to the sponsor every other day, and every Thursday at 4:30pm New York, but only when the
 * report has changed since the last one went out. A deal that is due shows under Ready for launch with a Handle
 * that replies all on the latest exchange with the sponsor, the fresh PDF attached. The draft is watched: once it
 * leaves Drafts (or a report email to the sponsor shows in Sent Items), the deal's reportSentAt moves and the clock restarts.
 */
const DAY = 86_400_000;
const LIVE_STAGES = ["Deal Taken To Market", "Intro To Capital Made", "Term Sheet Issued", "Term Sheet Signed"];
const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";

/** The most recent Thursday 4:30pm New York, as an instant. */
function lastThursdaySlot(now = new Date()): Date {
  const nyWall = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = now.getTime() - nyWall.getTime() + (nyWall.getTime() - Date.UTC(nyWall.getFullYear(), nyWall.getMonth(), nyWall.getDate(), nyWall.getHours(), nyWall.getMinutes(), nyWall.getSeconds()));
  const back = (nyWall.getDay() - 4 + 7) % 7; // days since Thursday
  let slot = Date.UTC(nyWall.getFullYear(), nyWall.getMonth(), nyWall.getDate() - back, 16, 30) + offset;
  if (slot > now.getTime()) slot -= 7 * DAY; // Thursday morning: last week's slot is the latest one that has passed
  return new Date(slot);
}

export type ReportDue = { id: string; name: string; sponsorName: string | null; groups: number; changedSince: number; lastSentAt: Date | null; reason: string };

/** Deals whose progress report changed since it was last sent, and whose next send is due. */
export async function reportsDue(): Promise<ReportDue[]> {
  await syncReportDrafts().catch(() => 0);
  const now = new Date();
  const thursday = lastThursdaySlot(now);
  const deals = await prisma.deal.findMany({ where: { stage: { in: LIVE_STAGES }, parentDealId: null, investors: { some: {} } }, select: { id: true, name: true, propertyName: true, sponsorName: true, reportSentAt: true, reportDraftAt: true, _count: { select: { investors: true } } } });
  if (!deals.length) return [];
  const changes = await prisma.dealInvestor.groupBy({ by: ["dealId"], where: { dealId: { in: deals.map((d) => d.id) } }, _max: { updatedAt: true } });
  const lastChange = new Map(changes.map((c) => [c.dealId, c._max.updatedAt]));
  const out: ReportDue[] = [];
  for (const d of deals) {
    if (d.reportDraftAt && now.getTime() - d.reportDraftAt.getTime() < 2 * DAY) continue; // a report draft is open in Outlook; wait for it to go
    const changed = lastChange.get(d.id);
    if (!changed) continue;
    if (d.reportSentAt && changed <= d.reportSentAt) continue; // nothing new to report
    const everyOtherDay = !d.reportSentAt || now.getTime() - d.reportSentAt.getTime() >= 2 * DAY;
    const thursdayDue = now >= thursday && (!d.reportSentAt || d.reportSentAt < thursday);
    if (!everyOtherDay && !thursdayDue) continue;
    const changedSince = d.reportSentAt ? await prisma.dealInvestor.count({ where: { dealId: d.id, updatedAt: { gt: d.reportSentAt } } }) : d._count.investors;
    out.push({ id: d.id, name: d.propertyName ?? d.name, sponsorName: d.sponsorName, groups: d._count.investors, changedSince, lastSentAt: d.reportSentAt, reason: thursdayDue && !everyOtherDay ? "Thursday 4:30 report" : d.reportSentAt ? `${Math.floor((now.getTime() - d.reportSentAt.getTime()) / DAY)} days since the last report` : "never sent" });
  }
  return out.sort((a, b) => b.changedSince - a.changedSince);
}

/** Report drafts that went out: the deal's clock restarts from the send. */
export async function syncReportDrafts(): Promise<number> {
  if (!graphConfigured()) return 0;
  const rows = await prisma.deal.findMany({ where: { reportDraftId: { not: null } }, select: { id: true, reportDraftId: true, reportDraftMailbox: true, reportDraftAt: true } });
  let n = 0;
  for (const d of rows) {
    try {
      const m = await getMessage(d.reportDraftMailbox!, d.reportDraftId!, "id,isDraft,sentDateTime");
      let sentAt: Date | null = m.isDraft ? null : m.sentDateTime ? new Date(m.sentDateTime) : new Date();
      if (!sentAt && d.reportDraftAt) {
        // Outlook built its own reply: a report email to any sponsor contact since the click counts
        const people = await sponsorContactsFor(d.id).catch(() => []);
        for (const p of people.slice(0, 3)) {
          const sent = await sentMessagesTo(d.reportDraftMailbox!, p.email, 5).catch(() => []);
          const hit = sent.find((x) => x.sentDateTime && new Date(x.sentDateTime) > d.reportDraftAt! && /progress report/i.test(x.subject ?? ""));
          if (hit?.sentDateTime) {
            sentAt = new Date(hit.sentDateTime);
            break;
          }
        }
      }
      if (!sentAt) continue;
      await prisma.deal.update({ where: { id: d.id }, data: { reportSentAt: sentAt, reportDraftId: null, reportDraftMailbox: null, reportDraftAt: null, updatedAt: sentAt } });
      n++;
    } catch (e) {
      if (String(e).includes("404")) await prisma.deal.update({ where: { id: d.id }, data: { reportDraftId: null, reportDraftMailbox: null, reportDraftAt: null } });
    }
  }
  return n;
}

/** Handle: reply all on the latest exchange with the sponsor, the fresh progress report attached. */
export async function openReportDraft(dealId: string, mailbox: string): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { sponsorCompany: { select: { domain: true } } } });
  if (!deal) return { ok: false, reason: "Deal not found." };
  const dealName = deal.propertyName ?? deal.name;
  // an unsent draft from an earlier click: reopen it
  if (deal.reportDraftId && deal.reportDraftMailbox) {
    const d = await getMessage(deal.reportDraftMailbox, deal.reportDraftId, "id,isDraft,webLink,internetMessageId").catch(() => null);
    if (d?.isDraft) return { ok: true, webLink: d.webLink ?? "", outlookLink: await outlookDesktopLink(deal.reportDraftMailbox, d.id), messageId: d.internetMessageId ?? null, mode: "replyAll", attachments: 1 };
  }
  const people = await sponsorContactsFor(dealId);
  if (!people.length) return { ok: false, reason: `No sponsor contact with an email on ${dealName}. Link the sponsor company on the ticket.` };
  const pdf = await buildProgressReportPdf(dealId);
  if (!pdf) return { ok: false, reason: "The progress report has nothing on it yet." };
  const first = people[0].firstName?.trim();
  const greeting = `Hi${first ? ` ${first}` : ""} - please find the updated progress report on ${dealName} attached.`;
  const sig = await signatureFor(mailbox);
  const block = `<div style="${F}"><p style="margin:0 0 12pt 0;${F}">${greeting}</p>${sig}<br></div>`;
  const thread = await sponsorThreadFor(mailbox, { id: deal.id, name: deal.name, propertyName: deal.propertyName, city: deal.city, state: deal.state, sponsorCompanyId: deal.sponsorCompanyId, requestedAmount: deal.requestedAmount }, { emails: people.map((p) => p.email), domain: deal.sponsorCompany?.domain ?? null }).catch(() => null);
  let draft = thread ? await createReplyAllDraft(mailbox, thread.messageId).catch(() => null) : null;
  let mode: "replyAll" | "new" = "replyAll";
  if (draft) {
    const body = draft.body?.content ?? "";
    await updateDraftBody(mailbox, draft.id, body.search(/<body[^>]*>/i) >= 0 ? body.replace(/(<body[^>]*>)/i, `$1${block}`) : `${block}${body}`);
  } else {
    draft = await createDraft(mailbox, { subject: `${dealName} | Progress Report`, toRecipients: people.map((p) => p.email), bodyHtml: `<html><body>${block}</body></html>` });
    mode = "new";
  }
  await addAttachment(mailbox, draft.id, { name: pdf.name, contentType: "application/pdf", bytes: pdf.bytes });
  await prisma.deal.update({ where: { id: dealId }, data: { reportDraftId: draft.id, reportDraftMailbox: mailbox, reportDraftAt: new Date() } });
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode, attachments: 1 };
}
