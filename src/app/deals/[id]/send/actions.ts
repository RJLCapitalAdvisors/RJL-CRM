"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { createSendDrafts, finalizeEngagement, launchDealEmails, renderDealEmail, sendPreviewToSelf, type LaunchItem, type SendItem } from "@/lib/send-deal";

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

export async function launchAction(dealId: string, items: LaunchItem[]) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the emails go from your own mailbox." };
  const results = await launchDealEmails(dealId, items, me.email);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}/send`);
  revalidatePath("/");
  return { ok: true as const, results };
}

export async function previewToMeAction(dealId: string, item: LaunchItem) {
  const me = await currentUser();
  if (!me) return { ok: false, error: "Sign in with Microsoft first." };
  return sendPreviewToSelf(dealId, item, me.email);
}
