"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sponsorSideIds } from "@/lib/report-guard";
import { logActivity } from "@/lib/activity";
import { AWAITING_RESPONSE, statusOf, passReasonOnly } from "@/lib/tracker";
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
  if (!statusOf(status) || status < 1 || status > 9) return;
  const before = await prisma.dealInvestor.findUnique({ where: { id: rowId }, select: { note: true } });
  // a pass or not-a-fit keeps only the reason on the report; the earlier entries go to the deal's log
  const kept = status === 7 || status === 8 ? passReasonOnly(before?.note) : before?.note ?? null;
  const row = await prisma.dealInvestor.update({ where: { id: rowId }, data: { status, ...(kept !== (before?.note ?? null) ? { note: kept } : {}) } });
  if (kept !== (before?.note ?? null) && before?.note) await logActivity({ type: "NOTE", body: `Report notes before the pass (kept off the report): ${before.note}`, contactId: row.contactId, dealId: row.dealId });
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
  const sponsorSide = await sponsorSideIds(dealId, fresh);
  const ok = fresh.filter((id) => !sponsorSide.has(id));
  if (ok.length) await prisma.dealInvestor.createMany({ data: ok.map((contactId) => ({ dealId, contactId, status: 1 })) });
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
/** The editor shows "• " in front of each line; the lines are stored bare. */
const strip = (v: string | null) => (v ? v.split("\n").map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean).join("\n") || null : null);
export async function saveTrackerMeta(dealId: string, fd: FormData) {
  const themes = strip(s(fd, "trackerThemes")), items = strip(s(fd, "trackerItemsNote"));
  const before = await prisma.deal.findUnique({ where: { id: dealId }, select: { trackerThemes: true, trackerItemsNote: true } });
  const edited = before != null && (before.trackerThemes !== themes || before.trackerItemsNote !== items);
  await prisma.deal.update({
    where: { id: dealId },
    // a hand edit is the text from now on: the writer keeps it and only adjusts for new notes, answered or passed groups (Jonathan, Sep 17)
    data: { trackerPreparedFor: s(fd, "trackerPreparedFor"), trackerThemes: themes, trackerItemsNote: items, trackerSummaryAt: new Date(), ...(edited ? { trackerManualAt: new Date() } : {}) },
  });
  touch(dealId);
  revalidatePath(`/share/tracker`);
}

/**
 * "Refresh report" (Jonathan, Sep 22, 2026): everything at once. The team mailboxes are read again, every email with
 * this deal's firms is tied to the deal and re-read for stance and asks, intro calls are looked for, and the themes and
 * Items Needed are rewritten from what is now on the rows. The page redraws when it returns.
 */
export async function refreshReportAction(dealId: string): Promise<{ ok: true; linked: number; moved: number } | { ok: false; reason: string }> {
  try {
    const { refreshResponses } = await import("@/lib/refresh-responses");
    const r = await refreshResponses(dealId);
    const { detectIntroCalls } = await import("@/lib/intro-calls");
    const calls = await detectIntroCalls().catch(() => ({ checked: 0, moved: 0 }));
    const { ensureTrackerSummary } = await import("@/lib/tracker-summary");
    await prisma.deal.update({ where: { id: dealId }, data: { trackerSummaryAt: null } }).catch(() => null);
    await ensureTrackerSummary(dealId).catch(() => null);
    revalidatePath(`/deals/${dealId}/tracker`);
    revalidatePath(`/deals/${dealId}`);
    revalidatePath("/share/tracker");
    revalidatePath("/");
    return { ok: true, linked: r.linked, moved: calls.moved };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

/** "Refresh responses": re-read the team mailboxes for this deal's firms and update statuses, notes and LP requests. */
export async function refreshResponsesAction(dealId: string) {
  const { refreshResponses } = await import("@/lib/refresh-responses");
  await refreshResponses(dealId).catch(() => null);
  revalidatePath(`/deals/${dealId}/tracker`);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
}
