import { prisma } from "../src/lib/db";

// Jonathan, Oct 26, 2026: the non-multifamily pref templates open like the multifamily ones ("RJL Capital Advisors is currently representing ...")
const EDITS: { id: string; from: string; to: string }[] = [
  {
    id: "cmtn5wzkp0005uj40eaowfqlg", // Non-Multifamily Pref Equity Existing Deals (updated)
    from: "<div>{{deal.sponsorName}} is looking to acquire {{deal.propertyName}}, in {{deal.location}}. The asset spans {{deal.squareFeet}} square feet{{deal.occupancyNote}}, and was built in {{deal.yearBuilt}}{{deal.acresClause}}. <strong>They are seeking",
    to: "<div>RJL Capital Advisors is currently representing {{deal.sponsorName}} as they source {{deal.executionType}} for the purchase of {{deal.propertyName}}, in {{deal.location}}. The asset spans {{deal.squareFeet}} square feet{{deal.occupancyNote}}, and was built in {{deal.yearBuilt}}{{deal.acresClause}}. {{deal.assetSellerSentence}} <strong>They are seeking",
  },
  {
    id: "cmtn5wzld000auj40gkk1dobd", // NON-Multifamily Pref Equity Development Deals (updated): the missing space after "representing" and the double space before "the"
    from: "<p>RJL Capital Advisors is pleased to be representing{{deal.sponsorName}} as they source preferred equity for  the development of {{deal.propertyName}}, in {{deal.location}}. The asset will span {{deal.squareFeet}} square feet{{deal.acresClause}}. <strong>They are seeking",
    to: "<p>RJL Capital Advisors is pleased to be representing {{deal.sponsorName}} as they raise {{deal.executionType}} to develop {{deal.propertyName}}, in {{deal.location}}. {{deal.propertyName}} will span {{deal.squareFeet}} square feet{{deal.acresClause}}. {{deal.landSellerSentence}} <strong>They are seeking",
  },
];

async function main() {
  for (const e of EDITS) {
    const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: e.id }, select: { name: true, bodyHtml: true } });
    if (!t.bodyHtml.includes(e.from)) { console.log(`SKIP ${t.name}: opening not as expected`); continue; }
    await prisma.emailTemplate.update({ where: { id: e.id }, data: { bodyHtml: t.bodyHtml.replace(e.from, e.to) } });
    console.log(`updated ${t.name}`);
  }
}
main().finally(() => prisma.$disconnect());
