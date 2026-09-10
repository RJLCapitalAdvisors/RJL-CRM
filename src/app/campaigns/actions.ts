"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { buildAudience } from "@/lib/audience";
import { mailConfigured, sendEmail } from "@/lib/mailer";
import { renderForRecipient } from "@/lib/campaign-render";
import { unsubscribeUrl } from "@/lib/tokens";
import { STATUS_FOLLOWED_UP, STATUS_SENT } from "@/lib/tracker";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export async function createCampaign(fd: FormData) {
  const dealId = s(fd, "dealId");
  const templateId = s(fd, "templateId");
  const role = s(fd, "role");
  const mode = s(fd, "mode") === "BLAST" ? "BLAST" : "OUTREACH";
  const minScore = Number(s(fd, "minScore") ?? 0) || 0;
  const selected = fd.getAll("contactId").map(String);
  if (!templateId) throw new Error("A template is required");
  if (mode === "OUTREACH" && !dealId) throw new Error("Deal outreach needs a deal");
  if (selected.length === 0) throw new Error("Select at least one recipient");

  const [deal, template] = await Promise.all([
    dealId ? prisma.deal.findUniqueOrThrow({ where: { id: dealId } }) : null,
    prisma.emailTemplate.findUniqueOrThrow({ where: { id: templateId } }),
  ]);
  const audience = deal ? await buildAudience(deal, role) : await buildAudience({ assetClass: null, state: null, requestedAmount: null, requestType: null, strategy: null }, role);
  const byId = new Map(audience.map((a) => [a.id, a]));

  const campaign = await prisma.campaign.create({
    data: {
      name: s(fd, "name") ?? `${deal ? deal.propertyName ?? deal.name : template.name} – ${role ?? "All"} – ${new Date().toLocaleDateString("en-US")}`,
      mode,
      dealId,
      templateId,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      roleFilter: role,
      minScore,
      fromName: s(fd, "fromName"),
      replyTo: s(fd, "replyTo"),
      recipients: {
        create: selected
          .filter((id) => byId.has(id))
          .map((id) => ({ contactId: id, matchScore: byId.get(id)!.match.score, matchReasons: JSON.stringify(byId.get(id)!.match.reasons) })),
      },
    },
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

export async function removeRecipient(campaignId: string, contactId: string) {
  await prisma.campaignRecipient.deleteMany({ where: { campaignId, contactId, status: { in: ["PENDING", "SKIPPED"] } } });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function updateCampaignCopy(id: string, fd: FormData) {
  await prisma.campaign.update({
    where: { id },
    data: { subject: s(fd, "subject") ?? "", bodyHtml: (fd.get("bodyHtml") as string | null) ?? "", fromName: s(fd, "fromName"), replyTo: s(fd, "replyTo") },
  });
  revalidatePath(`/campaigns/${id}`);
}

export async function deleteCampaign(id: string) {
  const sent = await prisma.campaignRecipient.count({ where: { campaignId: id, status: "SENT" } });
  if (sent > 0) throw new Error("This send already went out and cannot be deleted");
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns?list=1");
}

// ---------- one-at-a-time deal outreach ----------

async function loadRecipient(recipientId: string) {
  return prisma.campaignRecipient.findUniqueOrThrow({
    where: { id: recipientId },
    include: { campaign: { include: { deal: true } }, contact: { include: { company: true } } },
  });
}

async function nextPendingUrl(campaignId: string, afterId: string) {
  const all = await prisma.campaignRecipient.findMany({ where: { campaignId }, orderBy: [{ matchScore: "desc" }, { id: "asc" }], select: { id: true, status: true } });
  const idx = all.findIndex((r) => r.id === afterId);
  const next = [...all.slice(idx + 1), ...all.slice(0, idx)].find((r) => r.status === "PENDING");
  return next ? `/campaigns/${campaignId}?r=${next.id}` : `/campaigns/${campaignId}`;
}

async function refreshCampaignStatus(campaignId: string) {
  const [pending, sent] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "SENT" } }),
  ]);
  const status = pending === 0 && sent > 0 ? "SENT" : sent > 0 ? "IN_PROGRESS" : "DRAFT";
  await prisma.campaign.update({ where: { id: campaignId }, data: { status, sentAt: pending === 0 && sent > 0 ? new Date() : undefined } });
}

/** Save the personal opening line (and optional custom body) for one recipient. */
export async function updateRecipient(recipientId: string, fd: FormData) {
  const r = await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { openingLine: s(fd, "openingLine"), bodyOverride: fd.get("useCustomBody") === "on" ? ((fd.get("bodyOverride") as string | null)?.trim() || null) : null },
  });
  revalidatePath(`/campaigns/${r.campaignId}`);
}

async function logSent(recipientId: string, via: string, providerId?: string) {
  const r = await loadRecipient(recipientId);
  const { subject } = renderForRecipient({ ...r.campaign, deal: r.campaign.deal as unknown as Record<string, unknown> | null }, r);
  await prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: "SENT", sentVia: via, sentAt: new Date(), providerId: providerId ?? null, error: null } });
  await logActivity({
      type: "EMAIL",
      direction: "OUTBOUND",
      subject,
      body: `${r.campaign.mode === "OUTREACH" ? "Deal outreach" : "Campaign"}: ${r.campaign.name}${via === "outlook" ? " (sent from Outlook)" : ""}`,
      contactId: r.contactId,
      companyId: r.contact.companyId,
      dealId: r.campaign.dealId,
      externalId: providerId ? `resend:${providerId}` : null,
  });
  // Keep the deal progress tracker in step: sending moves the investor to Deal Sent (or Followed Up).
  if (r.campaign.dealId && r.campaign.mode === "OUTREACH") {
    const target = r.campaign.followUp ? STATUS_FOLLOWED_UP : STATUS_SENT;
    const row = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: r.campaign.dealId, contactId: r.contactId } } });
    if (!row) await prisma.dealInvestor.create({ data: { dealId: r.campaign.dealId, contactId: r.contactId, status: target } });
    else if (row.status < target) await prisma.dealInvestor.update({ where: { id: row.id }, data: { status: target } });
    revalidatePath(`/deals/${r.campaign.dealId}/tracker`);
  }
  await refreshCampaignStatus(r.campaignId);
  revalidatePath(`/campaigns/${r.campaignId}`);
  revalidatePath(`/contacts/${r.contactId}`);
  return r;
}

/** The user sent it themselves (e.g. via the Outlook button). Record it and move to the next one. */
export async function markRecipientSent(recipientId: string) {
  const r = await logSent(recipientId, "outlook");
  redirect(await nextPendingUrl(r.campaignId, recipientId));
}

export async function skipRecipient(recipientId: string) {
  const r = await prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: "SKIPPED" } });
  await refreshCampaignStatus(r.campaignId);
  revalidatePath(`/campaigns/${r.campaignId}`);
  redirect(await nextPendingUrl(r.campaignId, recipientId));
}

export async function unskipRecipient(recipientId: string) {
  const r = await prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: "PENDING" } });
  revalidatePath(`/campaigns/${r.campaignId}`);
}

/** Send this one recipient through the configured provider, then move to the next one. */
export async function sendOneRecipient(recipientId: string) {
  if (!mailConfigured()) throw new Error("Email sending is not configured. Add RESEND_API_KEY and MAIL_FROM to .env.");
  const r = await loadRecipient(recipientId);
  if (!r.contact.email || r.contact.unsubscribed) throw new Error("Contact has no email or is unsubscribed");
  const { subject, html } = renderForRecipient({ ...r.campaign, deal: r.campaign.deal as unknown as Record<string, unknown> | null }, r);
  try {
    const res = await sendEmail({ to: r.contact.email, subject, html, replyTo: r.campaign.replyTo ?? undefined });
    await logSent(recipientId, "resend", res.id);
  } catch (e) {
    await prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: "FAILED", error: String(e).slice(0, 500) } });
    revalidatePath(`/campaigns/${r.campaignId}`);
    return;
  }
  redirect(await nextPendingUrl(r.campaignId, recipientId));
}

// ---------- blast: send every pending recipient ----------

export async function sendCampaign(id: string) {
  if (!mailConfigured()) throw new Error("Email sending is not configured. Add RESEND_API_KEY and MAIL_FROM to .env, then restart the server.");
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: { deal: true, recipients: { where: { status: "PENDING" }, include: { contact: { include: { company: true } } } } },
  });
  await prisma.campaign.update({ where: { id }, data: { status: "SENDING" } });
  let sent = 0;
  let failed = 0;
  for (const r of campaign.recipients) {
    const c = r.contact;
    if (!c.email || c.unsubscribed) {
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: "UNSUBSCRIBED" } });
      continue;
    }
    const { subject, html } = renderForRecipient({ ...campaign, deal: campaign.deal as unknown as Record<string, unknown> | null }, r);
    try {
      const res = await sendEmail({ to: c.email, subject, html, replyTo: campaign.replyTo ?? undefined, headers: { "List-Unsubscribe": `<${unsubscribeUrl(c.id)}>` } });
      await logSent(r.id, "resend", res.id);
      sent++;
    } catch (e) {
      failed++;
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: String(e).slice(0, 500) } });
    }
  }
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId: id, status: { in: ["PENDING", "FAILED"] } } });
  await prisma.campaign.update({ where: { id }, data: { status: remaining ? "PARTIAL" : "SENT", sentAt: new Date() } });
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { sent, failed };
}

// ---------- blasts (segments, schedule, follow-ups) ----------
import { blastStats, cancelScheduleFor, createBlast, scheduleBlast, segmentContacts, sendBlast, sendTestBlast, type Segment } from "@/lib/blasts";
import { currentUser } from "@/lib/current-user";

export async function countSegmentAction(seg: Segment): Promise<{ total: number; sample: string[] }> {
  const rows = await segmentContacts(seg);
  return { total: rows.length, sample: rows.slice(0, 4).map((r) => r.company ?? r.name) };
}

export async function createBlastAction(input: { name: string; templateId: string; segment: Segment; scheduledAt: string | null; followUpDays: number[]; copy?: { subject: string; bodyHtml: string } | null }) {
  const me = await currentUser();
  let id: string;
  try {
    id = await createBlast({ ...input, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null, fromName: me?.name ?? null, replyTo: me?.email ?? null });
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${id}`);
}

export async function scheduleBlastAction(id: string, atIso: string) {
  await scheduleBlast(id, new Date(atIso));
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
}

export async function cancelScheduleAction(id: string) {
  await cancelScheduleFor(id);
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
}

export async function sendBlastNowAction(id: string): Promise<string> {
  const r = await sendBlast(id).catch((e) => ({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }));
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return "error" in r ? r.error : `Sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}.`;
}

export async function sendTestBlastAction(id: string) {
  const me = await currentUser();
  if (!me?.email) throw new Error("Sign in with Microsoft first.");
  await sendTestBlast(id, me.email);
}

export async function blastStatsAction(id: string) {
  return blastStats(id);
}

// ---------- the email being written: preview it, test it, save it ----------

const meAsReader = (me: { name: string; email: string } | null) => {
  const [firstName, ...rest] = (me?.name ?? "Test Reader").split(" ");
  return { contactId: "test", openingLine: null, bodyOverride: null, contact: { firstName, lastName: rest.join(" ") || null, email: me?.email ?? "test@example.com", company: { name: "RJL Capital Advisors" } } };
};

/** The email merged for the signed-in person, so the editor can show it the way a reader will see it. */
export async function previewCopyAction(copy: { subject: string; bodyHtml: string }): Promise<{ subject: string; html: string }> {
  const me = await currentUser();
  const { subject, html } = renderForRecipient({ mode: "BLAST", subject: copy.subject, bodyHtml: copy.bodyHtml, fromName: me?.name ?? null, replyTo: me?.email ?? null, deal: null }, meAsReader(me));
  return { subject, html };
}

/** One test email to yourself with the copy as it stands right now, before or after the blast exists. */
export async function sendTestCopyAction(copy: { subject: string; bodyHtml: string }): Promise<string> {
  const me = await currentUser();
  if (!me?.email) return "Sign in with Microsoft first.";
  try {
    const { subject, html } = renderForRecipient({ mode: "BLAST", subject: copy.subject, bodyHtml: copy.bodyHtml, fromName: me.name, replyTo: me.email, deal: null }, meAsReader(me));
    await sendEmail({ to: me.email, subject: `[TEST] ${subject}`, html, replyTo: me.email });
    return `Test sent to ${me.email}.`;
  } catch (e) {
    return String(e instanceof Error ? e.message : e).slice(0, 200);
  }
}

export async function saveBlastCopyAction(id: string, copy: { subject: string; bodyHtml: string }) {
  await prisma.campaign.update({ where: { id }, data: { subject: copy.subject, bodyHtml: copy.bodyHtml } });
  revalidatePath(`/campaigns/${id}`);
}
