"use server";

import { prisma } from "@/lib/db";

/** Name and stage of a deal for the sidebar's deal widget. */
export async function dealNavInfo(dealId: string): Promise<{ id: string; name: string; stage: string } | null> {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, name: true, propertyName: true, stage: true } });
  return d ? { id: d.id, name: d.propertyName ?? d.name, stage: d.stage } : null;
}
