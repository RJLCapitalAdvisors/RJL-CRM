import { prisma } from "@/lib/db";
import { DEAL_STAGES, introParties, isBlindIntro } from "@/lib/taxonomy";

/**
 * Jonathan's naming convention for every ticket from Deal Mentioned through Term Sheet Signed:
 *   a deal:  "Sponsor | Deal name"           (asset class, development or acquisitions, city, state and owner
 *                                              are their own fields and show as tokens on the card)
 *   an intro: "INTRO | Group 1 | Group 2"
 * Nothing is renamed on its own: a ticket that is off convention lands under Data updates as a proposal, and
 * approval writes the new name. Runs from the daily cron; one open proposal per deal at a time.
 */
const STAGES = DEAL_STAGES.slice(0, DEAL_STAGES.indexOf("Term Sheet Signed") + 1) as string[];
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function conventionalName(d: { name: string; propertyName: string | null; propertyAddress?: string | null; sponsorName: string | null; hubspotId?: string | null; fileCount?: number; factCount?: number }): string | null {
  if (isBlindIntro(d)) {
    const [a, b] = introParties(d.name);
    return a && b ? `INTRO | ${clean(a)} | ${clean(b)}` : null;
  }
  const property = clean(d.propertyName);
  const sponsor = clean(d.sponsorName);
  if (!property) return null; // nothing to name it after yet
  return sponsor ? `${sponsor} | ${property}` : property;
}

export async function proposeNamingConventions(): Promise<{ checked: number; proposed: number }> {
  const deals = await prisma.deal.findMany({ where: { stage: { in: STAGES }, parentDealId: null }, select: { id: true, name: true, propertyName: true, propertyAddress: true, sponsorName: true, hubspotId: true, _count: { select: { files: true, facts: true } } } });
  let proposed = 0;
  for (const d of deals) {
    const target = conventionalName({ ...d, fileCount: d._count.files, factCount: d._count.facts });
    if (!target || target === clean(d.name)) continue;
    const pending = await prisma.criteriaProposal.findFirst({ where: { dealId: d.id, status: "PENDING", changes: { contains: '"dealName"' } } });
    const change = { field: "dealName", from: d.name, to: target, evidence: target.startsWith("INTRO |") ? "Intro records read INTRO | Group 1 | Group 2" : "Tickets read Sponsor | Deal name; asset class, strategy, city, state and owner are their own fields" };
    if (pending) {
      if (!pending.changes.includes(JSON.stringify(target))) await prisma.criteriaProposal.update({ where: { id: pending.id }, data: { changes: JSON.stringify([change]) } });
      continue;
    }
    // a rename Jonathan already turned down is not asked again
    const rejected = await prisma.criteriaProposal.findFirst({ where: { dealId: d.id, status: "REJECTED", changes: { contains: JSON.stringify(target) } } });
    if (rejected) continue;
    await prisma.criteriaProposal.create({ data: { source: "NAMING", dealId: d.id, summary: `Rename to the convention: ${target}`, changes: JSON.stringify([change]) } });
    proposed++;
  }
  return { checked: deals.length, proposed };
}
