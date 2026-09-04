/*
  Import HubSpot CSV exports into the CRM database.
  Usage:  npm run import                 (companies, contacts, deals, then role sync)
          npm run import -- deals        (only deals)
          npm run import -- companies contacts
  Files expected in HUBSPOT_EXPORT_DIR: companies.csv, all-contacts.csv, deals.csv
  Re-runnable: rows are upserted by HubSpot Record ID. Checklist details are merged, not replaced.
*/
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  normalizeAssetClasses,
  normalizeCheckSizes,
  normalizeDealSizes,
  normalizeGeographies,
  normalizeInvestmentTypes,
  normalizeRoles,
  normalizeStrategy,
  normalizeVintages,
  toJson,
  US_STATES,
} from "../src/lib/taxonomy";
import { backfillContactRoles } from "../src/lib/roles";
import { parseDetails } from "../src/lib/checklist";

const prisma = new PrismaClient();
const dir = process.env.HUBSPOT_EXPORT_DIR;
if (!dir) throw new Error("HUBSPOT_EXPORT_DIR is not set in .env");
const only = new Set(process.argv.slice(2).map((a) => a.toLowerCase()));
const want = (name: string) => only.size === 0 || only.has(name);

// ---------- CSV ----------
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type Rec = Record<string, string>;
function readCSV(file: string): Rec[] {
  const text = fs.readFileSync(path.join(dir!, file), "utf8").replace(/^﻿/, "");
  const rows = parseCSV(text);
  const header = rows[0];
  const seen: Record<string, number> = {};
  const keys = header.map((h) => {
    const n = (seen[h] = (seen[h] ?? 0) + 1);
    return n === 1 ? h : `${h} #${n}`;
  });
  return rows
    .slice(1)
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// ---------- value parsers ----------
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const date = (v: string | undefined) => {
  if (!v) return null;
  const d = new Date(v.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
};
const num = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};
/** "$26,000,000" | "37.5MM" | "$111MM including GL | 75MM..." -> dollars (first amount) */
const money = (v: string | undefined) => {
  if (!v) return null;
  const m = v.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(mm|m|million|k|bn|b)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const u = (m[2] ?? "").toLowerCase();
  if (u === "mm" || u === "m" || u === "million") n *= 1_000_000;
  else if (u === "k") n *= 1_000;
  else if (u === "bn" || u === "b") n *= 1_000_000_000;
  return n;
};
/** "65.00%" -> 65 ; "0.65" -> 65 ; "6.75% Fixed (...)" -> 6.75 */
const pct = (v: string | undefined) => {
  if (!v) return null;
  const m = v.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!v.includes("%") && n <= 1) n *= 100;
  return isNaN(n) ? null : Math.round(n * 100) / 100;
};
/** "2.1x" -> 2.1 */
const mult = (v: string | undefined) => {
  if (!v) return null;
  const m = v.match(/(\d+(?:\.\d+)?)\s*x/i) ?? v.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};
const stateCode = (v: string | null) => {
  if (!v) return null;
  const s = v.trim();
  if (US_STATES[s.toUpperCase()]) return s.toUpperCase();
  const hit = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : null;
};

// ---------- owners ----------
const userCache = new Map<string, string>();
async function ownerId(raw: string | undefined): Promise<string | null> {
  const name = blank(raw);
  if (!name) return null;
  const active = !/deactivated/i.test(name);
  const clean = name.replace(/\s*\(Deactivated User\)\s*/i, "").trim();
  if (userCache.has(clean)) return userCache.get(clean)!;
  const existing = await prisma.user.findFirst({ where: { name: clean } });
  const user = existing ?? (await prisma.user.create({ data: { name: clean, active } }));
  userCache.set(clean, user.id);
  return user.id;
}

function criteriaFrom(r: Rec, isCompany: boolean) {
  const geoRaw = blank(r["Deal Location(s)"]);
  const data = {
    assetClasses: toJson(normalizeAssetClasses(r["Asset Classes"])),
    checkSizes: toJson(normalizeCheckSizes(r["Check Sizes"])),
    dealSizes: toJson(normalizeDealSizes(r["Deal Sizes"])),
    investmentTypes: toJson(normalizeInvestmentTypes(r["Type Of Investments"])),
    strategy: normalizeStrategy(r["Development or Acquisitions?"] ?? r["Development Or Acquisitions?"]),
    geographies: toJson(normalizeGeographies(geoRaw)),
    geographyNotes: geoRaw,
    vintages: toJson(normalizeVintages(r["Vintages Considered"])),
    lenderPricing: isCompany ? blank(r["Lender Pricing (BPS spread)"]) ?? blank(r["Pricing (For Lenders)  (Real) (Real) - to be transferred"]) : null,
    aum: isCompany ? blank(r["Portfolio Size (AUM)"]) : null,
    unitsManaged: isCompany ? blank(r["Portfolio Size (Units Under Management)"]) : null,
  };
  const hasAny =
    data.assetClasses !== "[]" ||
    data.checkSizes !== "[]" ||
    data.dealSizes !== "[]" ||
    data.investmentTypes !== "[]" ||
    data.strategy ||
    data.geographies !== "[]" ||
    data.geographyNotes ||
    data.vintages !== "[]" ||
    data.lenderPricing ||
    data.aum ||
    data.unitsManaged;
  return hasAny ? data : null;
}

// ---------- companies ----------
async function importCompanies() {
  const rows = readCSV("companies.csv");
  console.log(`companies.csv: ${rows.length} rows`);
  let n = 0;
  for (const r of rows) {
    const hubspotId = r["Record ID"];
    if (!hubspotId) continue;
    const roles = normalizeRoles(r["Investor, Sponsor, Lender or Broker?"], r["Investor, Sponsor, or Broker? (NULL)"]);
    const data = {
      name: blank(r["Company name"]) ?? "(Unnamed company)",
      roles: toJson(roles),
      streetAddress: blank(r["Street Address"]),
      city: blank(r["City"]),
      state: blank(r["State/Region"]),
      yearFounded: num(r["Year Founded"]) ? Math.trunc(num(r["Year Founded"])!) : null,
      ownerId: await ownerId(r["Company owner"]),
      lastActivityAt: date(r["Last Activity Date"]),
    };
    const company = await prisma.company.upsert({ where: { hubspotId }, create: { hubspotId, ...data }, update: data });
    const crit = criteriaFrom(r, true);
    if (crit) {
      await prisma.investorCriteria.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...crit }, update: crit });
    }
    if (++n % 500 === 0) console.log(`  companies ${n}`);
  }
  console.log(`  companies done: ${n}`);
}

// ---------- contacts ----------
async function importContacts() {
  const rows = readCSV("all-contacts.csv");
  console.log(`all-contacts.csv: ${rows.length} rows`);
  const companyByHs = new Map((await prisma.company.findMany({ select: { id: true, hubspotId: true } })).map((c) => [c.hubspotId!, c.id]));
  let n = 0;
  let stubs = 0;
  for (const r of rows) {
    const hubspotId = r["Record ID"];
    if (!hubspotId) continue;
    const hsCompany = blank(r["Primary Associated Company ID"]);
    let companyId: string | null = null;
    if (hsCompany) {
      companyId = companyByHs.get(hsCompany) ?? null;
      if (!companyId) {
        const name = blank(r["Company Name"]) ?? blank(r["Associated Company"]) ?? "(Unnamed company)";
        const c = await prisma.company.create({ data: { hubspotId: hsCompany, name } });
        companyByHs.set(hsCompany, c.id);
        companyId = c.id;
        stubs++;
      }
    }
    const roles = normalizeRoles(
      r["Sponsor, Lender, Investor, Retail Investor, or Broker?"],
      r["Sponsor, Investor, Retail Investor, or Broker?"],
      r["Sponsor, Investor, Retail Investor, or Broker? (Real)"],
      r["Investor, Sponsor, Lender or Broker? (Real) (Cloned)"]
    );
    const accreditedRaw = blank(r["Are You An Accredited Investor?"]);
    const email = blank(r["Email"])?.toLowerCase() ?? null;
    const data = {
      firstName: blank(r["First Name"]),
      lastName: blank(r["Last Name"]),
      email,
      phone: blank(r["Phone Number"]),
      roles: toJson(roles),
      accredited: accreditedRaw ? /^y/i.test(accreditedRaw) : null,
      streetAddress: blank(r["Street Address"]),
      companyId,
      ownerId: await ownerId(r["Contact owner"]),
      marketingContact: /^marketing contact$/i.test(r["Marketing contact status"] ?? ""),
      unsubscribed: /^true$/i.test(r["Unsubscribed from all email"] ?? ""),
      bounceReason: blank(r["Email hard bounce reason"]),
      lastActivityAt: date(r["Last Activity Date"]),
      createdAt: date(r["Create Date"]) ?? undefined,
    };
    const contact = await prisma.contact.upsert({ where: { hubspotId }, create: { hubspotId, ...data }, update: data });
    const crit = criteriaFrom(r, false);
    if (crit) {
      await prisma.investorCriteria.upsert({ where: { contactId: contact.id }, create: { contactId: contact.id, ...crit }, update: crit });
    }
    if (++n % 1000 === 0) console.log(`  contacts ${n}`);
  }
  console.log(`  contacts done: ${n} (created ${stubs} stub companies referenced only by contacts)`);
}

// ---------- deals ----------
const EQUITY_TYPES = ["JV Equity", "LP Equity", "Co-GP Equity", "Preferred Equity"];
const DEBT_TYPES = ["Senior Debt", "Mezz Debt"];

function executionType(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("mezz")) return "Mezz Debt";
  if (v.includes("senior") || v === "debt") return "Senior Debt";
  if (v.includes("pref")) return "Preferred Equity";
  if (v.includes("co-gp") || v.includes("co gp") || v.includes("cogp")) return "Co-GP Equity";
  if (v.includes("lp")) return "LP Equity";
  if (v.includes("jv")) return "JV Equity";
  if (v.includes("fund")) return "Fund Investment";
  return raw;
}

async function importDeals() {
  const rows = readCSV("deals.csv");
  console.log(`deals.csv: ${rows.length} rows`);
  const companyCache = new Map<string, string | null>();
  async function sponsorCompany(name: string | null) {
    if (!name) return null;
    if (companyCache.has(name)) return companyCache.get(name)!;
    const hit = (await prisma.company.findFirst({ where: { name: { equals: name } }, select: { id: true } })) ?? (await prisma.company.findFirst({ where: { name: { contains: name } }, select: { id: true } }));
    companyCache.set(name, hit?.id ?? null);
    return hit?.id ?? null;
  }

  let n = 0;
  for (const r of rows) {
    const hubspotId = r["Record ID"];
    if (!hubspotId) continue;
    const name = blank(r["Deal Name"]) ?? "(Unnamed deal)";
    const [first, ...rest] = name.split(" | ");
    const sponsorName = blank(r["Sponsor"]) ?? (rest.length ? first.trim() : null);
    const propertyName = blank(r["Asset Name"]) ?? (rest.length ? rest.join(" | ") : name);

    const cityState = blank(r["City, State"]);
    const [cityRaw, stateRaw] = cityState ? cityState.split(",").map((x) => x.trim()) : [null, null];

    const exec = executionType(blank(r["Execution Type"]));
    const requestType = exec ? (DEBT_TYPES.includes(exec) ? "Debt" : EQUITY_TYPES.includes(exec) || exec === "Fund Investment" ? "Equity" : null) : null;

    const ltv = pct(r["Debt LTV (debt ÷ purchase price)"]);
    const ltc = pct(r["Debt LTC (debt÷total capitalization)"]);
    const interestRate = blank(r["Debt Interest Rate"]);
    const loanTermRaw = blank(r["Loan Term"]);
    const io = blank(r["I/O or Amortizing"]);
    const loanTerm = [loanTermRaw, io].filter(Boolean).join(", ") || null;
    const lenderType = blank(r["Lender Type"])?.replace(/^\(|\)$/g, "").trim() ?? null;
    const onMarketRaw = blank(r["On or Off Market?"]);
    const onMarket = onMarketRaw ? (/off/i.test(onMarketRaw) ? false : /on/i.test(onMarketRaw) ? true : null) : null;
    const acres = blank(r["How Many Acres Does It Sit On?"]) ?? blank(r["Lot Size (acres)"]);
    const seller = blank(r["What kind of seller?"]);
    const expectedClose = blank(r["Expected Closed Date"]);
    const businessPlan = blank(r["Business Plan"]);
    const describe = blank(r["Describe the deal"]) ?? blank(r["Deal Description"]);
    const debtTermsParts = [ltc != null ? `${ltc}% LTC` : null, ltv != null ? `${ltv}% LTV` : null, interestRate, loanTerm].filter(Boolean);

    const existing = await prisma.deal.findUnique({ where: { hubspotId }, select: { details: true } });
    const details = parseDetails(existing?.details);
    const merge = (k: string, v: string | null) => {
      if (v) details[k] = v;
    };
    merge("acres", acres);
    merge("sellerProfile", seller);
    merge("lender", lenderType);
    merge("debtTerms", debtTermsParts.length ? debtTermsParts.join(", ") : null);
    merge("sourcing", onMarketRaw);
    merge("timeline", expectedClose);

    const data = {
      name,
      stage: blank(r["Deal Stage"]) ?? "Deal Received",
      sponsorName,
      sponsorCompanyId: await sponsorCompany(sponsorName),
      propertyName,
      propertyAddress: blank(r["Property Address"]),
      city: cityRaw,
      state: stateCode(stateRaw) ?? (cityRaw && !stateRaw ? stateCode(cityRaw) : null),
      assetClass: normalizeAssetClasses(blank(r["Asset Class 2.0"]) ?? blank(r["Asset Class"]))[0] ?? null,
      strategy: normalizeStrategy(r["Development or Acquisition"]),
      onMarket,
      requestType,
      executionType: exec,
      requestedAmount: money(r["Requested Equity Or Debt Amount"]) ?? money(r["Amount"]),
      totalEquity: money(r["Total Equity"]),
      totalDebt: money(r["Total Debt"]),
      totalCapitalization: money(r["Total Capitalization (found on sources and uses)"]),
      purchasePrice: money(r["Purchase Price"]),
      ltv,
      ltc,
      interestRate,
      loanTerm,
      lenderType,
      equityMultiple: mult(r["Equity Multiple"]),
      irr: pct(r["IRR"]),
      holdPeriod: blank(r["Hold period"]),
      yieldOnCost: pct(r["Yield On Cost At Stabilization"]),
      capRateY1: pct(r["Year 1 Cap Rate"]),
      capRateT12: pct(r["T12 Cap Rate"]),
      cashOnCash: pct(r["Stabilized Cash on Cash Return"]),
      projectedReturns: blank(r["Projected Returns"]),
      occupancy: pct(r["Occupancy %"]),
      units: num(r["How Many Units? (ONLY Multifamily)"]) ? Math.trunc(num(r["How Many Units? (ONLY Multifamily)"])!) : null,
      squareFeet: num(r["How Many Square Feet?"]) ?? num(r["GLA/Building SF"]),
      yearBuilt: blank(r["When was it built?"]) ?? blank(r["Year Built"]),
      unitMix: blank(r["Unit Mix Breakdown"]),
      expectedClose,
      closedLostReason: blank(r["Closed Lost Reason"]),
      closedWonReason: blank(r["Closed Won Reason"]),
      sponsorExperience: blank(r["Describe the sponsor experience"]),
      summary: [businessPlan, describe].filter(Boolean).join("\n\n") || null,
      details: JSON.stringify(details),
      closeDate: date(r["Close Date"]),
      ownerId: await ownerId(r["Deal owner"]),
      createdAt: date(r["Create Date"]) ?? undefined,
    };
    await prisma.deal.upsert({ where: { hubspotId }, create: { hubspotId, ...data }, update: data });
    if (++n % 200 === 0) console.log(`  deals ${n}`);
  }
  console.log(`  deals done: ${n}`);
}

async function main() {
  console.log(`Importing from ${dir}${only.size ? ` (only: ${[...only].join(", ")})` : ""}`);
  if (want("companies")) await importCompanies();
  if (want("contacts")) await importContacts();
  if (want("deals")) await importDeals();
  if (want("companies") || want("contacts")) {
    console.log("Syncing company roles down to contacts...");
    const synced = await backfillContactRoles(console.log);
    console.log(`  updated ${synced} contacts`);
  }
  const [c, k, d, u] = await Promise.all([prisma.company.count(), prisma.contact.count(), prisma.deal.count(), prisma.user.count()]);
  console.log(`\nTotals: ${c} companies, ${k} contacts, ${d} deals, ${u} users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
