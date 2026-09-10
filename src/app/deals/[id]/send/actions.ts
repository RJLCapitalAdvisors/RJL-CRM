"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { createSendDrafts, finalizeEngagement, renderDealEmail, renderGeneralDealEmail, reviseDealEmail, sendPreviewToSelf, type LaunchItem, type SendItem } from "@/lib/send-deal";
import { launchStatus, pumpLaunches, queueDealEmails, type LaunchStatus } from "@/lib/launch-queue";

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
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
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
export async function launchAction(dealId: string, items: LaunchItem[], fileKeys?: string[]) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the emails go from your own mailbox." };
  await queueDealEmails(dealId, items, me.email, fileKeys);
  await pumpLaunches(me.email, 5_000);
  // keep sending one every 30 seconds after this response goes back, so the launch finishes even if the tab is closed
  after(() => pumpLaunches(me.email, 270_000).catch(() => null));
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}/send`);
  revalidatePath("/");
  return { ok: true as const, status: await launchStatus(dealId) };
}

/** Called by the Send deal page every few seconds while a launch is running: send the next email if 30 seconds have passed. */
export async function pumpLaunchAction(dealId: string): Promise<LaunchStatus> {
  const me = await currentUser();
  if (me) await pumpLaunches(me.email, 4_000).catch(() => null);
  const st = await launchStatus(dealId);
  // a long pump in the background only when nobody is pacing this mailbox right now (no send in the last gap)
  if (me && st.queued > 0 && st.nextInMs === 0) after(() => pumpLaunches(me.email, 270_000).catch(() => null));
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

/** "Emphasize the business plan more": Claude edits the General email as asked. */
export async function reviseGeneralEmailAction(dealId: string, subject: string, html: string, instruction: string) {
  if (!instruction.trim()) return { error: "Say what to change." };
  return reviseDealEmail({ dealId, subject, html, instruction });
}

/** Autosave for the Send deal page: the General email, per-firm edits, who gets what, files, template. Kept on the deal. */
export async function saveSendStateAction(dealId: string, state: Record<string, unknown>) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { details: true } });
  if (!deal) return { ok: false as const };
  const details = JSON.parse(deal.details || "{}") as Record<string, unknown>;
  details.sendState = state;
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify(details) } });
  return { ok: true as const };
}
