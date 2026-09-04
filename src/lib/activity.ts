import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Log an activity and bump lastActivityAt on the contact and the company it belongs to.
 * Every email, note, and tracker change goes through here, so the Companies and Contacts
 * lists (sorted by last activity) keep the firms Jonathan is actually talking to at the top.
 */
export async function logActivity(data: Prisma.ActivityUncheckedCreateInput) {
  let companyId = data.companyId ?? null;
  if (!companyId && data.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: data.contactId }, select: { companyId: true } });
    companyId = c?.companyId ?? null;
  }
  const when = data.occurredAt ? new Date(data.occurredAt as string | Date) : new Date();
  const activity = await prisma.activity.create({ data: { ...data, companyId } });
  await Promise.all([
    data.contactId ? prisma.contact.update({ where: { id: data.contactId }, data: { lastActivityAt: when } }) : null,
    companyId ? prisma.company.update({ where: { id: companyId }, data: { lastActivityAt: when } }) : null,
  ]);
  return activity;
}
