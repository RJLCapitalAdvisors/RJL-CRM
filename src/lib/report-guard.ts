import { prisma } from "@/lib/db";

/**
 * The sponsor is never an LP. Anyone at the deal's sponsor company (by link or by email domain) stays off the
 * progress report, whatever path tries to add them: LP asks, reply matching, campaigns, launches, engagement.
 */
export async function sponsorSideIds(dealId: string, contactIds: string[]): Promise<Set<string>> {
  if (!contactIds.length) return new Set();
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { sponsorCompanyId: true, sponsorCompany: { select: { domain: true } } } });
  if (!deal?.sponsorCompanyId && !deal?.sponsorCompany?.domain) return new Set();
  const people = await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, companyId: true, email: true } });
  const domain = deal.sponsorCompany?.domain?.toLowerCase();
  return new Set(people.filter((p) => (deal.sponsorCompanyId && p.companyId === deal.sponsorCompanyId) || (domain && p.email?.toLowerCase().endsWith(`@${domain}`))).map((p) => p.id));
}

/** True when this contact belongs to the deal's sponsor. */
export async function isSponsorSide(dealId: string, contactId: string): Promise<boolean> {
  return (await sponsorSideIds(dealId, [contactId])).has(contactId);
}

/** Sweep: sponsor-side rows that slipped onto any report are removed. Returns how many. */
export async function removeSponsorRows(): Promise<number> {
  const rows = await prisma.dealInvestor.findMany({ where: { deal: { sponsorCompanyId: { not: null } } }, select: { id: true, dealId: true, contactId: true } });
  let n = 0;
  const byDeal = new Map<string, string[]>();
  for (const r of rows) byDeal.set(r.dealId, [...(byDeal.get(r.dealId) ?? []), r.contactId]);
  for (const [dealId, ids] of byDeal) {
    const bad = await sponsorSideIds(dealId, ids);
    if (!bad.size) continue;
    const del = await prisma.dealInvestor.deleteMany({ where: { dealId, contactId: { in: [...bad] } } });
    n += del.count;
  }
  return n;
}
