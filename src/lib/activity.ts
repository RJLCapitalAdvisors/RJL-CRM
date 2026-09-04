import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { parseList } from "@/lib/taxonomy";

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
  if (data.type === "EMAIL" && data.direction === "OUTBOUND" && companyId) refreshSponsorLater(companyId);
  return activity;
}

/** Jonathan's rule: every time a sponsor is emailed, re-read their website and add asset classes still missing. */
function refreshSponsorLater(companyId: string) {
  const run = async () => {
    const co = await prisma.company.findUnique({ where: { id: companyId }, select: { roles: true } });
    if (!co || !parseList(co.roles).includes("Sponsor")) return;
    const { enrichCompany } = await import("@/lib/enrich");
    await enrichCompany(companyId, { force: true }).catch(() => {});
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
