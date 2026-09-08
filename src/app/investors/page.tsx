import { prisma } from "@/lib/db";
import { checkRangeFrom } from "@/lib/ranges";
import { suggestInvestors } from "@/lib/suggest-investors";
import { PageHeader } from "@/components/ui";
import { INVESTMENT_TYPES, parseList } from "@/lib/taxonomy";
import { str } from "@/lib/format";
import { InvestorSearch, type InvestorRow, type Spec } from "./search";
import { vintageForYear } from "@/lib/investor-specs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function InvestorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dealId = str(sp.dealId);
  const mode = str(sp.mode) === "engagement" && dealId ? "engagement" : "search";
  // AI suggestions are a nice-to-have on the engagement page: cap the wait so the page never stalls on them
  const suggestions = mode === "engagement" && dealId ? await Promise.race([suggestInvestors(dealId, { force: str(sp.refresh) === "1" }).catch(() => []), new Promise<never[]>((r) => setTimeout(() => r([]), 40_000))]) : [];
  // Flat queries joined in code: SQLite caps query parameters, so nested includes over ~1,300 companies fail.
  const [companies, allCriteria, deal, deals] = await Promise.all([
    prisma.company.findMany({ where: { roles: { contains: "Investor" } }, select: { id: true, name: true, roles: true, domain: true, city: true, state: true, lastActivityAt: true }, orderBy: { name: "asc" } }),
    prisma.investorCriteria.findMany({ where: { companyId: { not: null } } }),
    dealId ? prisma.deal.findUnique({ where: { id: dealId } }) : null,
    prisma.deal.findMany({ where: { stage: { notIn: ["Deal Lost", "Deal Closed"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, propertyName: true, name: true }, take: 60 }),
  ]);

  const critByCompany = new Map(allCriteria.map((c) => [c.companyId!, c]));
  const rows: InvestorRow[] = companies.map((c) => {
    const cr = critByCompany.get(c.id) ?? null;
    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
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

  const preset: Partial<Spec> | null = deal
    ? {
        assetClass: deal.assetClass ? [deal.assetClass, "Asset Class Agnostic"] : [],
        checkMM: deal.requestedAmount ? Math.min(100, Math.max(1, Math.round(deal.requestedAmount / 1_000_000))) : null,
        investmentType: deal.executionType && (INVESTMENT_TYPES as readonly string[]).includes(deal.executionType) ? [deal.executionType] : deal.requestType === "Debt" ? ["Senior Debt", "Mezz Debt"] : deal.requestType === "Equity" ? ["JV Equity", "Co-GP Equity", "Preferred Equity"] : [],
        strategy: deal.strategy ? [deal.strategy] : [],
        vintage: vintageForYear(deal.yearBuilt) ? [vintageForYear(deal.yearBuilt)] : [],
      }
    : null;

  return (
    <>
      <PageHeader title="Investor search" compact={mode === "engagement"} subtitle={mode === "engagement" ? `${rows.length.toLocaleString()} investors` : `${rows.length.toLocaleString()} companies marked Investor. Type your deal specs on the left; the list updates as you go.`} />
      <InvestorSearch rows={rows} preset={preset} presetDealName={deal ? deal.propertyName ?? deal.name : null} deals={deals.map((d) => ({ id: d.id, name: d.propertyName ?? d.name }))}  mode={mode} dealId={dealId || null} suggestions={suggestions} />
    </>
  );
}
