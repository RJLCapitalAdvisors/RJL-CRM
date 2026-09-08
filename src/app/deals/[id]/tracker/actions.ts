"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AWAITING_RESPONSE, statusOf } from "@/lib/tracker";
import { generateTrackerSummary } from "@/lib/tracker-summary";
import { proposeCriteriaChanges } from "@/lib/criteria-proposals";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function touch(dealId: string) {
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/reports");
}

/** Rewrite "Notable Feedback Themes" and "Items Needed from Sponsor" from the notes, after the response is sent. */
function summarizeLater(dealId: string) {
  after(async () => {
    try {
      await generateTrackerSummary(dealId);
      touch(dealId);
    } catch (e) {
      console.error("tracker summary failed", e);
    }
  });
}

export async function regenerateTrackerSummary(dealId: string) {
  await generateTrackerSummary(dealId);
  touch(dealId);
}

export async function setTrackerStatus(rowId: string, status: number) {
  if (!statusOf(status) || status < 1 || status > 8) return;
  const row = await prisma.dealInvestor.update({ where: { id: rowId }, data: { status } });
  await logActivity({ type: "NOTE", body: `Tracker: ${statusOf(status).short}`, contactId: row.contactId, dealId: row.dealId });
  touch(row.dealId);
  if (row.note) summarizeLater(row.dealId);
}

export async function saveTrackerNote(rowId: string, fd: FormData) {
  const note = s(fd, "note");
  const row = await prisma.dealInvestor.update({ where: { id: rowId }, data: { note, noteDate: note ? new Date() : null }, include: { contact: { select: { companyId: true } } } });
  touch(row.dealId);
  summarizeLater(row.dealId);
  // What the investor said may correct their criteria: queue a proposal for Jonathan to approve on the To-do page.
  if (note && row.contact.companyId) {
    const companyId = row.contact.companyId;
    after(async () => {
      try {
        await proposeCriteriaChanges({ companyId, contactId: row.contactId, text: note, source: "NOTE", sourceRef: row.id });
        revalidatePath("/");
      } catch (e) {
        console.error("criteria proposal failed", e);
      }
    });
  }
}

export async function removeTrackerRow(rowId: string) {
  const row = await prisma.dealInvestor.delete({ where: { id: rowId } });
  touch(row.dealId);
}

/** Add contacts to the tracker (status 1, Deal Not Sent). Ignores contacts already on it. */
export async function addTrackerContacts(dealId: string, contactIds: string[]) {
  const existing = new Set((await prisma.dealInvestor.findMany({ where: { dealId }, select: { contactId: true } })).map((r) => r.contactId));
  const fresh = contactIds.filter((id) => !existing.has(id));
  if (fresh.length) await prisma.dealInvestor.createMany({ data: fresh.map((contactId) => ({ dealId, contactId, status: 1 })) });
  touch(dealId);
  return fresh.length;
}

export async function addTrackerContactAction(dealId: string, fd: FormData) {
  const id = s(fd, "contactId");
  if (id) await addTrackerContacts(dealId, [id]);
}

export async function searchContactsForTracker(q: string) {
  if (!q.trim()) return [];
  const rows = await prisma.contact.findMany({
    where: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] },
    select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } },
    take: 10,
    orderBy: { lastName: "asc" },
  });
  return rows.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(no name)", city: c.email, state: c.company?.name ?? null }));
}

// ---------- action items ----------
export async function addDealAction(dealId: string, fd: FormData) {
  const text = s(fd, "text");
  if (!text) return;
  await prisma.dealAction.create({ data: { dealId, text } });
  touch(dealId);
}
export async function toggleDealAction(id: string) {
  const a = await prisma.dealAction.findUniqueOrThrow({ where: { id } });
  await prisma.dealAction.update({ where: { id }, data: { done: !a.done } });
  touch(a.dealId);
}
export async function deleteDealAction(id: string) {
  const a = await prisma.dealAction.delete({ where: { id } });
  touch(a.dealId);
}

/**
 * Follow up with everyone who has not responded (status Deal Sent or Followed Up):
 * creates a one-at-a-time campaign with the follow-up template and opens the queue.
 */
export async function createFollowUpCampaign(dealId: string, fd: FormData) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
  const templateId = s(fd, "templateId");
  const template = templateId
    ? await prisma.emailTemplate.findUniqueOrThrow({ where: { id: templateId } })
    : await prisma.emailTemplate.findFirst({ where: { name: { contains: "Follow-up" } } });
  if (!template) throw new Error("No follow-up template found. Create one named 'Follow-up – confirm receipt'.");

  const rows = await prisma.dealInvestor.findMany({
    where: { dealId, status: { in: AWAITING_RESPONSE }, contact: { email: { not: null }, unsubscribed: false } },
    include: { contact: true },
    orderBy: { updatedAt: "asc" },
  });
  if (rows.length === 0) throw new Error("Everyone on the tracker has responded (or has no email).");

  const campaign = await prisma.campaign.create({
    data: {
      name: `${deal.propertyName ?? deal.name} – follow-up ${new Date().toLocaleDateString("en-US")}`,
      mode: "OUTREACH",
      followUp: true,
      dealId,
      templateId: template.id,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      roleFilter: "Investor",
      recipients: { create: rows.map((r) => ({ contactId: r.contactId, matchScore: 0, matchReasons: JSON.stringify([`Tracker: ${statusOf(r.status).short}`]) })) },
    },
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

/** Header fields of the progress report: prepared for, feedback themes, extra items needed. */
export async function saveTrackerMeta(dealId: string, fd: FormData) {
  await prisma.deal.update({
    where: { id: dealId },
    data: { trackerPreparedFor: s(fd, "trackerPreparedFor"), trackerThemes: s(fd, "trackerThemes"), trackerItemsNote: s(fd, "trackerItemsNote") },
  });
  touch(dealId);
  revalidatePath(`/share/tracker`);
}

/** "Refresh responses": re-read the team mailboxes for this deal's firms and update statuses, notes and LP requests. */
export async function refreshResponsesAction(dealId: string) {
  const { refreshResponses } = await import("@/lib/refresh-responses");
  await refreshResponses(dealId).catch(() => null);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
}
