"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { createSendDrafts, finalizeEngagement, launchDealEmails, renderDealEmail, renderGeneralDealEmail, reviseDealEmail, sendPreviewToSelf, type LaunchItem, type SendItem } from "@/lib/send-deal";

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

export async function launchAction(dealId: string, items: LaunchItem[], fileKeys?: string[]) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the emails go from your own mailbox." };
  const results = await launchDealEmails(dealId, items, me.email, fileKeys);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}/send`);
  revalidatePath("/");
  return { ok: true as const, results };
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
