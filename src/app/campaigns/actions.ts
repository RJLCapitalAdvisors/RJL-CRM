"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildAudience } from "@/lib/audience";
import { renderTemplate, toHtml, type MergeContext } from "@/lib/merge";
import { mailConfigured, sendEmail } from "@/lib/mailer";
import { unsubscribeUrl } from "@/lib/tokens";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export async function createCampaign(fd: FormData) {
  const dealId = s(fd, "dealId");
  const templateId = s(fd, "templateId");
  const role = s(fd, "role");
  const minScore = Number(s(fd, "minScore") ?? 0) || 0;
  const selected = fd.getAll("contactId").map(String);
  if (!dealId || !templateId) throw new Error("Deal and template are required");
  if (selected.length === 0) throw new Error("Select at least one recipient");

  const [deal, template] = await Promise.all([
    prisma.deal.findUniqueOrThrow({ where: { id: dealId } }),
    prisma.emailTemplate.findUniqueOrThrow({ where: { id: templateId } }),
  ]);
  const audience = await buildAudience(deal, role);
  const byId = new Map(audience.map((a) => [a.id, a]));

  const campaign = await prisma.campaign.create({
    data: {
      name: s(fd, "name") ?? `${deal.propertyName ?? deal.name} – ${role ?? "All"} – ${new Date().toLocaleDateString("en-US")}`,
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
          .map((id) => ({
            contactId: id,
            matchScore: byId.get(id)!.match.score,
            matchReasons: JSON.stringify(byId.get(id)!.match.reasons),
          })),
      },
    },
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

export async function removeRecipient(campaignId: string, contactId: string) {
  await prisma.campaignRecipient.deleteMany({ where: { campaignId, contactId, status: "PENDING" } });
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
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== "DRAFT") throw new Error("Only draft campaigns can be deleted");
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

/** Send every PENDING recipient. Safe to re-run after a partial failure. */
export async function sendCampaign(id: string) {
  if (!mailConfigured()) throw new Error("Email sending is not configured. Add RESEND_API_KEY and MAIL_FROM to .env, then restart the server.");
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: { deal: true, recipients: { where: { status: "PENDING" }, include: { contact: { include: { company: true } } } } },
  });
  await prisma.campaign.update({ where: { id }, data: { status: "SENDING" } });
  const senderName = campaign.fromName ?? (process.env.MAIL_FROM ?? "").replace(/<.*$/, "").trim() ?? "RJL Capital Advisors";
  let sent = 0;
  let failed = 0;

  for (const r of campaign.recipients) {
    const c = r.contact;
    if (!c.email || c.unsubscribed) {
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: "UNSUBSCRIBED" } });
      continue;
    }
    const ctx: MergeContext = {
      contact: c,
      company: c.company,
      deal: campaign.deal as unknown as Record<string, unknown>,
      sender: { name: senderName },
      unsubscribeUrl: unsubscribeUrl(c.id),
    };
    const subject = renderTemplate(campaign.subject, ctx);
    const html = toHtml(renderTemplate(campaign.bodyHtml, ctx));
    try {
      const res = await sendEmail({
        to: c.email,
        subject,
        html,
        replyTo: campaign.replyTo ?? undefined,
        headers: { "List-Unsubscribe": `<${ctx.unsubscribeUrl}>` },
      });
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: "SENT", providerId: res.id, sentAt: new Date(), error: null } });
      await prisma.activity.create({
        data: {
          type: "EMAIL",
          direction: "OUTBOUND",
          subject,
          body: `Campaign: ${campaign.name}`,
          contactId: c.id,
          companyId: c.companyId,
          dealId: campaign.dealId,
          externalId: `resend:${res.id}`,
        },
      });
      await prisma.contact.update({ where: { id: c.id }, data: { lastActivityAt: new Date() } });
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
