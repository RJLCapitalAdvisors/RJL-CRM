import { prisma } from "@/lib/db";

/**
 * Pricing updates (Jonathan, Sep 17): every three months, each apartment, house and project asks to have its pricing
 * checked with the agent or developer, so the CRM never quotes a stale number. The clock runs from the last
 * check (priceCheckedAt), or from when the ticket was created when it has never been checked; saving a new asking
 * price on a ticket counts as a check. Due tickets sit in the dashboard's Pricing updates window until someone
 * clicks "Pricing confirmed" or saves a price.
 */
export const PRICE_CHECK_DAYS = 90;
const DAY = 86_400_000;

export type PricingDue = {
  id: string;
  kind: "apartments" | "houses" | "projects";
  name: string;
  place: string | null;
  priceNis: number | null;
  who: string | null; // the agent or developer to ask
  lastChecked: Date | null;
  since: Date; // when the clock started (last check, or creation)
  daysOver: number;
};

export async function pricingDue(limit = 40): Promise<{ rows: PricingDue[]; total: number }> {
  const cutoff = new Date(Date.now() - PRICE_CHECK_DAYS * DAY);
  const dueWhere = { OR: [{ priceCheckedAt: { lt: cutoff } }, { priceCheckedAt: null, createdAt: { lt: cutoff } }] };
  const [apts, houses, projects] = await Promise.all([
    prisma.ilApartment.findMany({ where: { pendingApproval: false, ...dueWhere }, select: { id: true, name: true, city: true, neighborhood: true, priceNis: true, createdAt: true, priceCheckedAt: true, agent: { select: { firstName: true, lastName: true } }, developer: { select: { name: true } } } }),
    prisma.ilHouse.findMany({ where: { pendingApproval: false, ...dueWhere }, select: { id: true, name: true, city: true, neighborhood: true, priceNis: true, createdAt: true, priceCheckedAt: true, agent: { select: { firstName: true, lastName: true } }, developer: { select: { name: true } } } }),
    prisma.ilProject.findMany({ where: dueWhere, select: { id: true, name: true, city: true, neighborhood: true, createdAt: true, priceCheckedAt: true, developer: { select: { name: true } } } }),
  ]);
  const now = Date.now();
  const who = (r: { agent?: { firstName: string | null; lastName: string | null } | null; developer?: { name: string } | null }) => {
    const agent = r.agent ? [r.agent.firstName, r.agent.lastName].filter(Boolean).join(" ") : "";
    return agent || r.developer?.name || null;
  };
  const row = (kind: PricingDue["kind"], r: { id: string; name: string; city: string | null; neighborhood: string | null; priceNis?: number | null; createdAt: Date; priceCheckedAt: Date | null; agent?: { firstName: string | null; lastName: string | null } | null; developer?: { name: string } | null }): PricingDue => {
    const since = r.priceCheckedAt ?? r.createdAt;
    return { id: r.id, kind, name: r.name, place: [r.neighborhood, r.city].filter(Boolean).join(", ") || null, priceNis: r.priceNis ?? null, who: who(r), lastChecked: r.priceCheckedAt, since, daysOver: Math.floor((now - since.getTime()) / DAY) - PRICE_CHECK_DAYS };
  };
  const rows = [...apts.map((a) => row("apartments", a)), ...houses.map((h) => row("houses", h)), ...projects.map((p) => row("projects", p))].sort((a, b) => b.daysOver - a.daysOver);
  return { rows: rows.slice(0, limit), total: rows.length };
}
