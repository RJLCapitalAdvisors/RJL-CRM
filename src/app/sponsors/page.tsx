import { prisma } from "@/lib/db";
import { checkRangeFrom } from "@/lib/ranges";
import { PageHeader } from "@/components/ui";
import { parseList } from "@/lib/taxonomy";
import { InvestorSearch, type InvestorRow } from "../investors/search";
import { recentOutreaches } from "@/lib/outreach";

export const metadata = { title: "Sponsor search" };

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Sponsor search (Jonathan, Oct 28, 2026): the Investor search page for sponsors. Fewer filters (where the firm sits, asset class,
 * acquisition or development, whether they have sent us a deal), no Make list, and the same Reach out: tick up to thirty, write one
 * email, the brochure goes on every one, sent one at a time.
 */
export default async function SponsorsPage() {
  const [companies, allCriteria, outreaches] = await Promise.all([
    // a company with no name (an email domain the sync could not name) is nothing to reach out to
    prisma.company.findMany({ where: { roles: { contains: "Sponsor" }, NOT: { name: { startsWith: "(Unnamed" } } }, select: { id: true, name: true, domain: true, city: true, state: true, lastActivityAt: true, _count: { select: { deals: true } } }, orderBy: { name: "asc" } }),
    prisma.investorCriteria.findMany({ where: { companyId: { not: null } }, select: { companyId: true, assetClasses: true, checkSizes: true, checkMinMM: true, checkMaxMM: true, geographyNotes: true, investmentTypes: true, strategy: true, returnProfile: true, holdPeriods: true, vintages: true, ozInterest: true, closingTimeframe: true, openToMinority: true } }),
    recentOutreaches("sponsor").catch(() => []),
  ]);
  const critByCompany = new Map(allCriteria.map((c) => [c.companyId!, c]));
  const rows: InvestorRow[] = companies.map((c) => {
    const cr = critByCompany.get(c.id) ?? null;
    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
      city: c.city,
      state: c.state,
      deals: c._count.deals,
      lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
      crit: cr
        ? {
            assetClasses: parseList(cr.assetClasses),
            checkSizes: parseList(cr.checkSizes),
            checkMin: cr.checkMinMM ?? checkRangeFrom(parseList(cr.checkSizes))?.[0] ?? null,
            checkMax: cr.checkMaxMM ?? checkRangeFrom(parseList(cr.checkSizes))?.[1] ?? null,
            geographyNotes: cr.geographyNotes,
            investmentTypes: parseList(cr.investmentTypes),
            strategy: cr.strategy,
            returnProfile: parseList(cr.returnProfile),
            holdPeriods: parseList(cr.holdPeriods),
            vintages: parseList(cr.vintages),
            ozInterest: cr.ozInterest,
            closingTimeframe: cr.closingTimeframe,
            openToMinority: cr.openToMinority,
          }
        : null,
    };
  });

  return (
    <>
      <PageHeader title="Sponsor search" subtitle={`${rows.length.toLocaleString()} companies marked Sponsor. Filter on the left; Reach out ticks up to 30 and sends them the brochure one at a time.`} />
      <InvestorSearch rows={rows} preset={null} presetDealName={null} deals={[]} mode="search" audience="sponsor" outreaches={outreaches.map((o) => ({ id: o.id, name: o.name, firms: o.firms, sent: o.sent }))} />
    </>
  );
}
