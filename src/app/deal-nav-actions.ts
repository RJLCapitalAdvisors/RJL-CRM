"use server";

import { prisma } from "@/lib/db";

/** Name and stage of a deal for the sidebar's deal widget. */
export async function dealNavInfo(dealId: string): Promise<{ id: string; name: string; stage: string; audience?: "investor" | "sponsor" } | null> {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, name: true, propertyName: true, stage: true, details: true } });
  return d ? { id: d.id, name: d.propertyName ?? d.name, stage: d.stage, audience: (await import("@/lib/outreach")).outreachAudience(d.details) } : null;
}

/**
 * The latest reach out (Investor search > Reach out), for the sidebar block under Investor search: it stays there until a newer one
 * starts (Jonathan, Oct 28, 2026). Your own latest, not the team's (Jonathan, Nov 23, 2026: Aviel's newer sponsor reach out had taken
 * over his Follow ups link): a colleague starting one never moves yours. Who was already reached out to stays shared (lastReachOutByCompany).
 */
export async function latestOutreachNavInfo(audience: "investor" | "sponsor" = "investor"): Promise<{ id: string; name: string; stage: string; audience?: "investor" | "sponsor" } | null> {
  const { audienceWhere } = await import("@/lib/outreach");
  const me = await (await import("@/lib/current-user")).currentUser().catch(() => null);
  const d = await prisma.deal.findFirst({ where: { ...audienceWhere(audience), ...(me ? { ownerId: me.id } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, stage: true } });
  return d ? { id: d.id, name: d.name, stage: d.stage, audience } : null;
}
