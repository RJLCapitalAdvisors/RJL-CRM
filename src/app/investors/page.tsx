import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { parseList } from "@/lib/taxonomy";
import { fullName, str } from "@/lib/format";
import { InvestorSearch, type InvestorRow, type Spec } from "./search";

export const dynamic = "force-dynamic";

export default async function InvestorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dealId = str(sp.dealId);
  const [companies, deal, deals] = await Promise.all([
    prisma.company.findMany({
      where: { roles: { contains: "Investor" } },
      select: {
        id: true, name: true, roles: true, city: true, state: true, lastActivityAt: true,
        criteria: true,
        contacts: { where: { email: { not: null }, unsubscribed: false }, select: { id: true, firstName: true, lastName: true, email: true, lastActivityAt: true }, orderBy: { lastActivityAt: "desc" } },
      },
      orderBy: { name: "asc" },
    }),
    dealId ? prisma.deal.findUnique({ where: { id: dealId } }) : null,
    prisma.deal.findMany({ where: { stage: { notIn: ["Deal Lost", "Deal Closed"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, propertyName: true, name: true }, take: 60 }),
  ]);

  const rows: InvestorRow[] = companies.map((c) => {
    const cr = c.criteria;
    const best = c.contacts[0];
    const roles = parseList(c.roles);
    return {
      id: c.id,
      name: c.name,
      location: [c.city, c.state].filter(Boolean).join(", "),
      retail: roles.includes("Retail Investor") && !roles.includes("Investor"),
      contactCount: c.contacts.length,
      bestContact: best ? { id: best.id, name: fullName(best), email: best.email! } : null,
      lastActivity: c.lastActivityAt?.toISOString() ?? null,
      crit: cr
        ? {
            assetClasses: parseList(cr.assetClasses),
            checkSizes: parseList(cr.checkSizes),
            geographies: parseList(cr.geographies),
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
    ? { assetClass: deal.assetClass ?? "", state: deal.state ?? "", amount: deal.requestedAmount ? String(deal.requestedAmount) : "", requestType: deal.requestType ?? "", strategy: deal.strategy ?? "", yearBuilt: deal.yearBuilt ?? "" }
    : null;

  return (
    <>
      <PageHeader title="Investor search" subtitle={`${rows.length.toLocaleString()} companies marked Investor. Type your deal specs on the left; the list updates as you go.`} />
      <InvestorSearch rows={rows} preset={preset} presetDealName={deal ? deal.propertyName ?? deal.name : null} deals={deals.map((d) => ({ id: d.id, name: d.propertyName ?? d.name }))} />
    </>
  );
}
