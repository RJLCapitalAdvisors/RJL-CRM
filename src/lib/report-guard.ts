import { prisma } from "@/lib/db";

/**
 * The sponsor is never an LP. Anyone at the deal's sponsor company (by link or by email domain) stays off the
 * progress report, whatever path tries to add them: LP asks, reply matching, campaigns, launches, engagement.
 */
const normCo = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\b(llc|l\.l\.c|inc|lp|llp|ltd|corp|co|company|the|group|partners|capital|holdings|development|developments|realty|properties|joint venture|jv)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The co-sponsors named on the deal's sponsor line ("IndiCap, LLC / VAC Development (joint venture)"): a joint venture's second
 * partner is a sponsor too, never an LP (Jonathan, Oct 12, 2026: VAC Development sat on the Shallow Bay report as Intro Made).
 */
export function sponsorLineNames(sponsorName: string | null | undefined): string[] {
  if (!sponsorName) return [];
  return sponsorName.split(/\s*(?:\/|&|\||\+|;|\band\b|\bx\b|,\s*(?!(?:llc|inc|lp|llp|ltd|l\.l\.c)\b))\s*/i).map(normCo).filter((p) => p.length >= 3);
}
const coNamed = (company: string | null | undefined, names: string[]) => {
  const c = normCo(company ?? "");
  return Boolean(c) && c.length >= 3 && names.some((n) => n === c || (n.length >= 4 && c.length >= 4 && (n.startsWith(c + " ") || c.startsWith(n + " ") || n === c)));
};

export async function sponsorSideIds(dealId: string, contactIds: string[]): Promise<Set<string>> {
  if (!contactIds.length) return new Set();
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { sponsorName: true, sponsorCompanyId: true, sponsorCompany: { select: { domain: true } } } });
  const names = sponsorLineNames(deal?.sponsorName);
  if (!deal || (!deal.sponsorCompanyId && !deal.sponsorCompany?.domain && !names.length)) return new Set();
  const people = await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, companyId: true, email: true, company: { select: { name: true } } } });
  const domain = deal.sponsorCompany?.domain?.toLowerCase();
  return new Set(people.filter((p) => (deal.sponsorCompanyId && p.companyId === deal.sponsorCompanyId) || (domain && p.email?.toLowerCase().endsWith(`@${domain}`)) || coNamed(p.company?.name, names)).map((p) => p.id));
}

/** True when this contact belongs to the deal's sponsor. */
export async function isSponsorSide(dealId: string, contactId: string): Promise<boolean> {
  return (await sponsorSideIds(dealId, [contactId])).has(contactId);
}

/** Sweep: sponsor-side rows that slipped onto any report are removed. Returns how many. */
export async function removeSponsorRows(): Promise<number> {
  const rows = await prisma.dealInvestor.findMany({ where: { deal: { OR: [{ sponsorCompanyId: { not: null } }, { sponsorName: { not: null } }] } }, select: { id: true, dealId: true, contactId: true } });
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
