"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { createSendDrafts, finalizeEngagement, renderDealEmail, renderGeneralDealEmail, reviseDealEmail, sendPreviewToSelf, type LaunchItem, type SendItem } from "@/lib/send-deal";
import { kickPump, launchStatus, pumpLaunches, queueDealEmails, retryFailed, type LaunchStatus } from "@/lib/launch-queue";

type Mode = "send" | "followup";
const KIND = (mode: Mode) => (mode === "followup" ? "FOLLOWUP" : "SEND") as "SEND" | "FOLLOWUP";
const STATE_KEY = (mode: Mode) => (mode === "followup" ? "followupState" : "sendState");
/** The pump runs on the server from here on; when it cannot be reached (no CRON_SECRET locally), this request pumps for a while itself. */
async function drive(mailbox: string) {
  if (!(await kickPump())) after(() => pumpLaunches(mailbox, 270_000).catch(() => null));
}

/** A group added on the Send deal page: its usual person joins the progress report as Deal Not Sent, so the firm has a token to send (Jonathan, Oct 1, 2026). */
export async function addFirmAction(dealId: string, companyId: string): Promise<{ ok: boolean; reason?: string }> {
  const { bestContactForCompany } = await import("@/lib/engagement");
  const { isSponsorSide } = await import("@/lib/report-guard");
  const c = await bestContactForCompany(companyId);
  if (!c) return { ok: false, reason: "Nobody with an email at that firm yet; add a contact first." };
  if (await isSponsorSide(dealId, c.id)) return { ok: false, reason: "That firm is on the sponsor's side of this deal." };
  const exists = await prisma.dealInvestor.findFirst({ where: { dealId, contact: { companyId } } });
  if (!exists) await prisma.dealInvestor.create({ data: { dealId, contactId: c.id, status: 1 } });
  revalidatePath(`/deals/${dealId}/send`);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  return { ok: true };
}

/** A first name typed into a firm's greeting is that person's first name from now on (Jonathan, Oct 1, 2026). */
export async function learnFirstNameAction(contactId: string, firstName: string): Promise<{ ok: boolean }> {
  const name = firstName.trim().replace(/[^A-Za-z'’.-]/g, "").slice(0, 40);
  if (!name) return { ok: false };
  await prisma.contact.update({ where: { id: contactId }, data: { firstName: name } }).catch(() => null);
  return { ok: true };
}

export async function finalizeEngagementAction(dealId: string, keepCompanyIds: string[], addCompanyIds: string[]) {
  const r = await finalizeEngagement(dealId, keepCompanyIds, addCompanyIds);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath("/deals");
  return r;
}

export async function searchInvestorCompanies(q: string) {
  if (!q.trim()) return [];
  const rows = await prisma.company.findMany({ where: { roles: { contains: "Investor" }, name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true }, take: 8, orderBy: { name: "asc" } });
  return rows;
}

/** Live preview of one recipient's email as it will be drafted. */
export async function previewDealEmail(dealId: string, templateId: string, contactId: string, openingLine: string | null, bodyOverride: string | null) {
  const me = await currentUser();
  const { withChildren } = await import("@/lib/portfolio");
  const deal = await withChildren(await prisma.deal.findUniqueOrThrow({ where: { id: dealId } }));
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId }, include: { company: true } });
  const r = await renderDealEmail({ templateId, deal: deal as unknown as Record<string, unknown>, contact, company: contact.company, openingLine, bodyOverride, senderName: me?.name ?? "RJL Capital Advisors", mailbox: me?.email ?? "jonathan@rjlcapadvisors.com" });
  return { subject: r.subject, html: r.html };
}

export async function createSendDraftsAction(dealId: string, templateId: string, items: SendItem[]) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the drafts are created in your own mailbox." };
  const results = await createSendDrafts(dealId, templateId, items, me.email, me.name);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}/send`);
  return { ok: true as const, results };
}

/** LAUNCH: queue one email per firm, send the first now, the rest one every 30 seconds while the page keeps pumping. */
export async function launchAction(dealId: string, items: LaunchItem[], fileKeys?: string[], mode: Mode = "send") {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the emails go from your own mailbox." };
  await queueDealEmails(dealId, items, me.email, fileKeys, { followup: mode === "followup" });
  await pumpLaunches(me.email, 5_000);
  // the server keeps sending on its own from here (the pump route calls itself while anything is queued)
  await drive(me.email);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}/send`);
  revalidatePath("/");
  return { ok: true as const, status: await launchStatus(dealId, KIND(mode)) };
}

/** Called by the Send deal page every few seconds while a launch is running: send the next email if 30 seconds have passed. */
export async function pumpLaunchAction(dealId: string, mode: Mode = "send"): Promise<LaunchStatus> {
  const me = await currentUser();
  if (me) await pumpLaunches(me.email, 4_000).catch(() => null);
  let st = await launchStatus(dealId, KIND(mode));
  if (me && st.queued === 0) {
    // the launch is done: bounces that came back are matched to their firms
    const { scanLaunchBounces } = await import("@/lib/launch-queue");
    if (await scanLaunchBounces(me.email).catch(() => 0)) st = await launchStatus(dealId, KIND(mode));
  }
  // a long pump in the background only when nobody is pacing this mailbox right now (no send in the last gap)
  if (me && st.queued > 0 && st.nextInMs === 0) await drive(me.email);
  if (st.queued === 0) {
    revalidatePath(`/deals/${dealId}`);
    revalidatePath(`/deals/${dealId}/tracker`);
  }
  return st;
}

export async function previewToMeAction(dealId: string, item: LaunchItem, fileKeys?: string[]) {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Sign in with Microsoft first." };
  return sendPreviewToSelf(dealId, item, me.email, fileKeys);
}

/** The General email: the deal email with nobody's name, which every firm's email derives from. */
export async function previewGeneralEmail(dealId: string, templateId: string) {
  const me = await currentUser();
  const r = await renderGeneralDealEmail({ templateId, dealId, senderName: me?.name ?? "RJL Capital Advisors", mailbox: me?.email ?? "jonathan@rjlcapadvisors.com" });
  return { subject: r.subject, html: r.html };
}

/** The follow-up's General email: a line asking for a read, with the name slot, above the quoted deal email (Jonathan, Oct 1, 2026). */
export async function previewFollowupEmail(dealId: string) {
  const { FIRST_NAME_MARKER } = await import("@/lib/first-name-marker");
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { name: true, propertyName: true } });
  const first = await prisma.dealLaunch.findFirst({ where: { dealId, kind: "SEND", status: { in: ["SENT", "BOUNCED"] } }, orderBy: { createdAt: "asc" }, select: { subject: true } });
  const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  return { subject: first ? `RE: ${first.subject}` : `RE: ${deal?.propertyName ?? deal?.name ?? "the deal"}`, html: `<div style="${F}"><p style="margin:0 0 10pt 0;${F}">Hi ${FIRST_NAME_MARKER} - please confirm receipt of the below, and let me know if ${deal?.propertyName ?? "this"} is something you would like to take a closer look at.</p></div>` };
}

/** "Emphasize the business plan more": Claude edits the General email as asked. */
export async function reviseGeneralEmailAction(dealId: string, subject: string, html: string, instruction: string) {
  if (!instruction.trim()) return { error: "Say what to change." };
  return reviseDealEmail({ dealId, subject, html, instruction });
}

/** Autosave for the Send deal page: the General email, per-firm edits, who gets what, files, template. Kept on the deal. */
export async function saveSendStateAction(dealId: string, state: Record<string, unknown>, mode: Mode = "send") {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { details: true } });
  if (!deal) return { ok: false as const };
  const details = JSON.parse(deal.details || "{}") as Record<string, unknown>;
  details[STATE_KEY(mode)] = state;
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify(details) } });
  return { ok: true as const };
}

/** After the letter is signed the sponsor can still strike or add a group: the agreed list and the progress report follow, the stage stays. */
export async function updateAgreedGroupsAction(dealId: string, keepCompanyIds: string[], addCompanyIds: string[]) {
  const r = await finalizeEngagement(dealId, keepCompanyIds, addCompanyIds, { markSigned: false });
  revalidatePath(`/deals/${dealId}`);
  return r;
}

/** Failed emails go back in the queue and the sending resumes at the paced rate. */
export async function retryFailedAction(dealId: string, mode: Mode = "send"): Promise<{ ok: true; requeued: number; status: LaunchStatus } | { ok: false; reason: string }> {
  const me = await currentUser();
  if (!me) return { ok: false, reason: "Sign in with Microsoft (bottom of the sidebar) so the emails go from your own mailbox." };
  const requeued = await retryFailed(dealId, KIND(mode));
  await pumpLaunches(me.email, 5_000);
  await drive(me.email);
  revalidatePath(`/deals/${dealId}/send`);
  return { ok: true, requeued, status: await launchStatus(dealId, KIND(mode)) };
}
