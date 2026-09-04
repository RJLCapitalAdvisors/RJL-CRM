/*
  Import HubSpot sales email templates (CSV export) into EmailTemplate, translating HubSpot
  personalization tokens ({{ deal.asset_name }}) into CRM merge fields ({{deal.propertyName}}).
  Usage: npx tsx scripts/import-templates.ts "<path to templates.csv>"
  Re-runnable: matches on template name and updates in place.
*/
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../src/lib/db";
import { MERGE_FIELDS } from "../src/lib/merge";

const file = process.argv[2];
if (!file) throw new Error("Pass the path to the HubSpot templates CSV");

// HubSpot internal property name -> CRM merge field
const TOKEN_MAP: Record<string, string> = {
  "contact.firstname": "contact.firstName|there",
  "contact.lastname": "contact.lastName",
  "contact.email": "contact.email",
  // In deal templates HubSpot's "company" is the deal's associated company, i.e. the sponsor.
  "company.name": "deal.sponsorName",
  "deal.sponsor": "deal.sponsorName",
  "deal.asset_name": "deal.propertyName",
  "deal.dealname": "deal.propertyName",
  "deal.property_address": "deal.propertyAddress",
  "deal.deal_location": "deal.location",
  "deal.city__state": "deal.location",
  "deal.asset_class": "deal.assetClass",
  "deal.asset_class_2_0": "deal.assetClass",
  "deal.development_or_acquisition": "deal.strategy",
  "deal.estimated_equity": "deal.requestedAmount",
  "deal.requested_equity_or_debt_amount": "deal.requestedAmount",
  "deal.amount": "deal.requestedAmount",
  "deal.execution_type": "deal.executionType",
  "deal.how_many_square_feet_": "deal.squareFeet",
  "deal.how_many_units_": "deal.units",
  "deal.how_many_acres_does_it_sit_on_": "deal.details.acres",
  "deal.lot_size_acres": "deal.details.acres",
  "deal.when_was_it_built_": "deal.yearBuilt",
  "deal.year_built": "deal.yearBuilt",
  "deal.unit_mix_breakdown": "deal.unitMix",
  "deal.describe_the_deal": "deal.summary",
  "deal.business_plan": "deal.summary",
  "deal.describe_the_sponsor_experience": "deal.sponsorExperience",
  "deal.total_capitalization": "deal.totalCapitalization",
  "deal.total_capitalization__found_on_sources_and_uses_": "deal.totalCapitalization",
  "deal.purchase_price": "deal.purchasePrice",
  "deal.total_equity": "deal.totalEquity",
  "deal.total_debt": "deal.totalDebt",
  "deal.debt_ltv": "deal.ltv",
  "deal.ltv": "deal.ltv",
  "deal.debt_ltc": "deal.ltc",
  "deal.ltc": "deal.ltc",
  "deal.debt_interest_rate": "deal.interestRate",
  "deal.loan_term": "deal.loanTerm",
  "deal.i_o_or_amortizing": "deal.details.ioAmortizing", // already folded into deal.loanTerm on import; renders blank
  "deal.lender_type": "deal.lenderType",
  "deal.irr": "deal.irr",
  "deal.equity_multiple": "deal.equityMultiple",
  "deal.hold_period": "deal.holdPeriod",
  "deal.yield_on_cost_at_stabilization": "deal.yieldOnCost",
  "deal.year_1_cap_rate": "deal.capRateY1",
  "deal.t12_cap_rate": "deal.capRateT12",
  "deal.stabilized_cash_on_cash_return": "deal.cashOnCash",
  "deal.projected_returns": "deal.projectedReturns",
  "deal.occupancy_": "deal.occupancy",
  "deal.occupancy": "deal.occupancy",
  "deal.fannie_or_freddie_": "deal.lenderType",
  "deal.purchase_price_per_unit": "deal.pricePerUnit",
  "deal.purchase_price_per_foot": "deal.pricePerFoot",
  "deal.total_capitalization_per_unit": "deal.capPerUnit",
  "deal.total_capitalization_per_foot": "deal.capPerFoot",
  "deal.average_unit_square_footage": "deal.avgUnitSize",
  "deal.t_12_tax_adjusted_cap_rate": "deal.capRateT12",
  "deal.glabuilding_sf": "deal.squareFeet",
  "deal.on_or_off_market_": "deal.details.sourcing",
  "deal.what_kind_of_seller_": "deal.details.sellerProfile",
  "deal.expected_closed_date": "deal.expectedClose",
  "deal.closedate": "deal.expectedClose",
  "deal.loan_expectations": "deal.details.debtTerms",
  "deal.last_dollar_exposure____amount__ltc__ltv_on_pp_": "deal.lastDollar",
  "deal.pref_ltc": "deal.prefLtc",
  "deal.pref_ltv": "deal.prefLtv",
  "deal.going_in_yield_on_last_dollar": "deal.goingInYieldLD",
  "deal.stabilized_yield_on_last_dollar": "deal.stabilizedYieldLD",
  "deal.stabilized_basis_on_last_pref_dollar": "deal.basisLD",
  "owner.firstname": "sender.name",
  "owner.fullname": "sender.name",
};

function parseCSV(t: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}

const known = new Set(MERGE_FIELDS.map((f) => f.key));
const unmapped = new Map<string, Set<string>>();

function translate(text: string, templateName: string): string {
  return text
    .replace(/[​‌‍﻿]/g, "") // zero-width characters HubSpot sprinkles around tokens
    .replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, token: string) => {
      const mapped = TOKEN_MAP[token.toLowerCase()];
      if (mapped) return `{{${mapped}}}`;
      // Unknown HubSpot property: keep it under deal.details so it renders blank until filled.
      const key = token.replace(/^deal\./, "");
      const target = token.startsWith("deal.") ? `deal.details.${key}` : token;
      if (!known.has(target.split("|")[0])) {
        if (!unmapped.has(token)) unmapped.set(token, new Set());
        unmapped.get(token)!.add(templateName);
      }
      return `{{${target}}}`;
    });
}


(async () => {
  const rows = parseCSV(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const h = rows[0];
  const col = (r: string[], name: string) => r[h.indexOf(name)] ?? "";
  let added = 0;
  let updated = 0;
  for (const r of rows.slice(1)) {
    if (r.length < 3) continue;
    const name = col(r, "Name").trim();
    const subject = translate(col(r, "Subject"), name);
    let body = translate(col(r, "Body"), name);
    // The generic opener becomes a per-recipient personal line in deal outreach.
    body = body.replace(/(\s*[-–—]\s*)hope you are well\.?/i, "$1{{openingLine|hope you are well.}}");
    const sends = col(r, "Send Count");
    const existing = await prisma.emailTemplate.findFirst({ where: { name } });
    if (existing) {
      await prisma.emailTemplate.update({ where: { id: existing.id }, data: { subject, bodyHtml: body, kind: "DEAL" } });
      updated++;
    } else {
      await prisma.emailTemplate.create({ data: { name, subject, bodyHtml: body, kind: "DEAL" } });
      added++;
    }
    console.log(`${existing ? "updated" : "added  "} ${name}  (HubSpot sends: ${sends})`);
  }
  console.log(`\n${added} added, ${updated} updated`);
  if (unmapped.size) {
    console.log("\nHubSpot fields with no CRM equivalent yet (kept as {{deal.details.*}}, render blank until filled):");
    for (const [tok, names] of unmapped) console.log(`  ${tok}  <- ${[...names].join("; ")}`);
  }
  await prisma.$disconnect();
})();
