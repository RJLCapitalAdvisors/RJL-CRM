import { prisma } from "@/lib/db";
import { renderForRecipient } from "@/lib/campaign-render";

// CSV of every recipient with their personalized subject and body (plain text).
// Usable directly as an Outlook / Word mail-merge data source.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { deal: true, recipients: { include: { contact: { include: { company: true } } }, orderBy: { matchScore: "desc" } } },
  });
  if (!campaign) return new Response("Not found", { status: 404 });
  const dealCtx = { ...campaign, deal: campaign.deal as unknown as Record<string, unknown> | null };

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Email", "First Name", "Last Name", "Company", "Match Score", "Match Reasons", "Status", "Opening Line", "Subject", "Body"];
  const lines = [header.map(esc).join(",")];
  for (const r of campaign.recipients) {
    const { subject, text } = renderForRecipient(dealCtx, r);
    lines.push(
      [r.contact.email, r.contact.firstName, r.contact.lastName, r.contact.company?.name, r.matchScore, JSON.parse(r.matchReasons || "[]").join("; "), r.status, r.openingLine, subject, text].map(esc).join(",")
    );
  }
  const safe = campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.csv"` },
  });
}
