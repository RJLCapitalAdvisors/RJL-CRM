import { prisma } from "@/lib/db";
import { renderTemplate, type MergeContext } from "@/lib/merge";
import { unsubscribeUrl } from "@/lib/tokens";

// CSV of every recipient with their personalized subject and body.
// Usable directly as an Outlook / Word mail-merge data source until API sending is configured.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { deal: true, recipients: { include: { contact: { include: { company: true } } }, orderBy: { matchScore: "desc" } } },
  });
  if (!campaign) return new Response("Not found", { status: 404 });
  const senderName = campaign.fromName ?? (process.env.MAIL_FROM ?? "RJL Capital Advisors").replace(/<.*$/, "").trim();

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Email", "First Name", "Last Name", "Company", "Match Score", "Match Reasons", "Status", "Subject", "Body"];
  const lines = [header.map(esc).join(",")];
  for (const r of campaign.recipients) {
    const ctx: MergeContext = {
      contact: r.contact,
      company: r.contact.company,
      deal: campaign.deal as unknown as Record<string, unknown>,
      sender: { name: senderName },
      unsubscribeUrl: unsubscribeUrl(r.contactId),
    };
    lines.push(
      [
        r.contact.email,
        r.contact.firstName,
        r.contact.lastName,
        r.contact.company?.name,
        r.matchScore,
        JSON.parse(r.matchReasons || "[]").join("; "),
        r.status,
        renderTemplate(campaign.subject, ctx),
        renderTemplate(campaign.bodyHtml, ctx),
      ]
        .map(esc)
        .join(",")
    );
  }
  const safe = campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.csv"` },
  });
}
