/* Seed starter email templates. Re-runnable: skips templates whose name already exists. */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const templates = [
  {
    name: "Follow-up – confirm receipt",
    subject: "Re: {{deal.propertyName}} – {{deal.requestedAmount}} of {{deal.executionType|capital}}",
    bodyHtml: `Hi {{contact.firstName|there}} - {{openingLine|hope you are well.}} Please confirm receipt of {{deal.propertyName}} and let me know if it is something you would take a look at.

Best,
{{sender.name}}
RJL Capital Advisors`,
  },
  {
    name: "Deal intro – investors",
    subject: "{{deal.assetClass|CRE}} opportunity: {{deal.propertyName}} – {{deal.requestedAmount}} {{deal.requestType}}",
    bodyHtml: `Hi {{contact.firstName|there}},

We are advising {{deal.sponsorName}} on {{deal.propertyName}}{{deal.city| in }}{{deal.city}}{{deal.state|, }}{{deal.state}} and are seeking {{deal.requestedAmount}} of {{deal.requestType|capital}}.

Quick facts:
• Asset class: {{deal.assetClass}}
• Strategy: {{deal.strategy}}
• Purchase price: {{deal.purchasePrice}}
• Total equity: {{deal.totalEquity}}
• Debt LTV: {{deal.ltv}}
• Occupancy: {{deal.occupancy}}
• Projected equity multiple: {{deal.equityMultiple}}x

{{deal.summary}}

{{deal.facts}}

Based on what we know of {{company.name|your}} criteria, this looked like a fit. Would you like the full package?

Best,
{{sender.name}}
RJL Capital Advisors

If you'd prefer not to receive deal emails, unsubscribe here: {{unsubscribeUrl}}`,
  },
  {
    name: "Investor outreach – criteria call (legacy 2024)",
    subject: "CRE Investment Opportunity {{deal.assetClass|Sunbelt MF}}",
    bodyHtml: `Hi {{contact.firstName|there}} – we are currently working with one of the largest sponsors in South Florida to programmatically acquire Class A Multifamily across the sunbelt.

We'd love the opportunity to connect with {{company.name|your family office}} and learn your criteria for CRE investments.

Do you have the time to discuss this briefly?

{{sender.name}}
RJL Capital Advisors

Unsubscribe: {{unsubscribeUrl}}`,
  },
  {
    name: "Sponsor check-in – new capital sources",
    subject: "New capital sources for {{company.name|your}} pipeline",
    bodyHtml: `Hi {{contact.firstName|there}},

We have added several new equity and debt sources this quarter and wanted to check what you have in the pipeline. If you have anything in underwriting or under contract, send over the basics (address, asset class, purchase price, requested amount, timeline) and we will let you know quickly whether we have a fit.

Best,
{{sender.name}}
RJL Capital Advisors

Unsubscribe: {{unsubscribeUrl}}`,
  },
];

(async () => {
  for (const t of templates) {
    const exists = await prisma.emailTemplate.findFirst({ where: { name: t.name } });
    if (exists) {
      console.log(`skip  ${t.name}`);
      continue;
    }
    await prisma.emailTemplate.create({ data: t });
    console.log(`added ${t.name}`);
  }
  await prisma.$disconnect();
})();
