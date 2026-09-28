"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { engagementGroups, finalizeEngagement } from "@/lib/send-deal";

type Struck = { name: string; companyId: string | null; how: string; at: string; by: string | null };

/**
 * One tick on the Agreed groups page, saved as it happens (Jonathan, Sep 28, 2026). An untick is recorded on the deal
 * as a struck entry ("unticked by Jonathan Livi, Sep 28") so the group stays on the list greyed out, beside the ones the
 * sponsor erased or crossed out; a tick removes that entry. After the letter is signed the progress report follows at
 * once: an unticked group comes off the report, a re-ticked one goes back on.
 */
export async function tickGroupAction(dealId: string, companyId: string, ticked: boolean): Promise<{ ok: boolean; agreed?: number }> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { stage: true, details: true } });
  if (!deal) return { ok: false };
  const me = await currentUser();
  const details = (() => { try { return JSON.parse(deal.details || "{}") as Record<string, unknown>; } catch { return {}; } })();
  const struck = ((details.engagementStruck as Struck[] | undefined) ?? []);
  const groups = await engagementGroups(dealId);
  const name = groups.find((g) => g.companyId === companyId)?.name ?? struck.find((s) => s.companyId === companyId)?.name ?? (await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name ?? "";
  const next = ticked ? struck.filter((s) => s.companyId !== companyId) : struck.some((s) => s.companyId === companyId) ? struck : [...struck, { name, companyId, how: "unticked", at: new Date().toISOString(), by: me?.name ?? "RJL" }];
  await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...details, engagementStruck: next }) } });
  let agreed: number | undefined;
  if (deal.stage !== "Engagement Letter Sent" && groups.length) {
    // signed (or further along): the report follows the ticks straight away
    const keep = groups.filter((g) => g.companyId && g.companyId !== companyId && !next.some((s) => s.companyId === g.companyId)).map((g) => g.companyId);
    if (ticked) keep.push(companyId);
    const onReport = groups.some((g) => g.companyId === companyId);
    const r = await finalizeEngagement(dealId, keep, ticked && !onReport ? [companyId] : [], { markSigned: false });
    agreed = r.agreed;
  }
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/groups`);
  revalidatePath(`/deals/${dealId}/tracker`);
  return { ok: true, agreed };
}

/** A group the sponsor asked for, added to the list (and to the report once signed). */
export async function addGroupAction(dealId: string, companyId: string) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { stage: true } });
  if (!deal) return { ok: false };
  const groups = await engagementGroups(dealId);
  const keep = groups.filter((g) => g.companyId).map((g) => g.companyId);
  const r = await finalizeEngagement(dealId, keep, [companyId], { markSigned: false });
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/groups`);
  return { ok: true, added: r.added };
}
