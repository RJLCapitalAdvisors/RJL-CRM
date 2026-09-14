import { prisma } from "@/lib/db";
import { DEAL_STAGES } from "@/lib/taxonomy";

/**
 * Culling: a deal between Deal Received and Intro To Capital Made with nothing happening for STALE_DAYS
 * (no email, no note, no report change, no edit) is probably dead. It shows under Data updates for Jonathan to
 * move to Deal Lost, which takes it off Deal momentum and LP follow-ups. "Keep" hides it for another STALE_DAYS.
 */
export const STALE_DAYS = 7;
const DAY = 86_400_000;
// Deal Received or further: a deal that was only mentioned in passing is not worth a culling decision
const STALE_STAGES = DEAL_STAGES.slice(DEAL_STAGES.indexOf("Deal Received"), DEAL_STAGES.indexOf("Intro To Capital Made") + 1) as string[];

export type StaleDeal = { id: string; name: string; stage: string; sponsorName: string | null; lastActivityAt: Date; quietDays: number; investors: number };

export async function staleDeals(): Promise<StaleDeal[]> {
  const cutoff = new Date(Date.now() - STALE_DAYS * DAY);
  const deals = await prisma.deal.findMany({
    where: { stage: { in: STALE_STAGES }, parentDealId: null, updatedAt: { lt: cutoff }, staleHandledAt: null, OR: [{ staleCheckedAt: null }, { staleCheckedAt: { lt: cutoff } }] },
    select: { id: true, name: true, propertyName: true, stage: true, sponsorName: true, updatedAt: true, _count: { select: { investors: true } } },
  });
  if (!deals.length) return [];
  const ids = deals.map((d) => d.id);
  const [acts, rows] = await Promise.all([
    prisma.activity.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { occurredAt: true } }),
    prisma.dealInvestor.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { updatedAt: true } }),
  ]);
  const lastAct = new Map(acts.map((a) => [a.dealId, a._max.occurredAt]));
  const lastRow = new Map(rows.map((r) => [r.dealId, r._max.updatedAt]));
  const out: StaleDeal[] = [];
  for (const d of deals) {
    const last = new Date(Math.max(d.updatedAt.getTime(), lastAct.get(d.id)?.getTime() ?? 0, lastRow.get(d.id)?.getTime() ?? 0));
    if (last >= cutoff) continue;
    out.push({ id: d.id, name: d.propertyName ?? d.name, stage: d.stage, sponsorName: d.sponsorName, lastActivityAt: last, quietDays: Math.floor((Date.now() - last.getTime()) / DAY), investors: d._count.investors });
  }
  // the ones that went quiet most recently first: those are the live decisions; the old backlog follows
  return out.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}
