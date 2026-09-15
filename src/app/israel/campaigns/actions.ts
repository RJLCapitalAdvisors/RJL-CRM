"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { createIlBlast, ilSegmentContacts, sendIlBlast, sendIlTest, type IlSegment } from "@/lib/il-blasts";

export async function countIlSegmentAction(seg: IlSegment): Promise<{ total: number; sample: string[] }> {
  const rows = await ilSegmentContacts(seg);
  return { total: rows.length, sample: rows.slice(0, 3).map((r) => r.name) };
}

export async function createIlBlastAction(input: { name: string; subject: string; bodyHtml: string; segment: IlSegment; templateId?: string | null }): Promise<{ error: string } | void> {
  if (!input.subject.trim() || !input.bodyHtml.trim()) return { error: "The email needs a subject and a body." };
  const me = await currentUser();
  const id = await createIlBlast({ ...input, replyTo: me?.accounts.IL ?? me?.israelEmail ?? me?.email ?? null });
  revalidatePath("/israel/campaigns");
  redirect(`/israel/campaigns/${id}`);
}

export async function saveIlBlastCopyAction(id: string, copy: { subject: string; bodyHtml: string }) {
  await prisma.ilCampaign.update({ where: { id }, data: { subject: copy.subject, bodyHtml: copy.bodyHtml } });
  revalidatePath(`/israel/campaigns/${id}`);
}

export async function sendIlBlastNowAction(id: string): Promise<string> {
  const r = await sendIlBlast(id);
  revalidatePath(`/israel/campaigns/${id}`);
  revalidatePath("/israel/campaigns");
  return `Sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""}.`;
}

export async function sendIlTestAction(id: string): Promise<string> {
  const me = await currentUser();
  const to = me?.accounts.IL ?? me?.israelEmail ?? me?.email;
  if (!to) return "Sign in first so the test has somewhere to go.";
  await sendIlTest(id, to);
  return `Test sent to ${to}.`;
}

export async function deleteIlBlastAction(id: string) {
  await prisma.ilCampaign.delete({ where: { id } });
  revalidatePath("/israel/campaigns");
  redirect("/israel/campaigns");
}

export async function removeIlRecipientAction(campaignId: string, contactId: string) {
  await prisma.ilCampaignRecipient.deleteMany({ where: { campaignId, contactId, status: "PENDING" } });
  revalidatePath(`/israel/campaigns/${campaignId}`);
}
