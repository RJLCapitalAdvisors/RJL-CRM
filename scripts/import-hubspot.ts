/*
  Import HubSpot CSV exports into the CRM database.
  Usage:  npm run import           (reads HUBSPOT_EXPORT_DIR from .env)
  Files expected: companies.csv, all-contacts.csv, deals.csv
  Re-runnable: rows are upserted by HubSpot Record ID.
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
} from "../src/lib/taxonomy";
import { backfillContactRoles } from "../src/lib/roles";

const prisma = new PrismaClient();
const dir = process.env.HUBSPOT_EXPORT_DIR;
if (!dir) throw new Error("HUBSPOT_EXPORT_DIR is not set in .env");

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
  // Duplicate headers get a numeric suffix so no column is lost.
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

// ---------- owners ----------
const userCache = new Map<string, string>();
async function ownerId(raw: string | undefined): Promise<string | null> {
  const name = blank(raw);
  if (!name) return null;
  const active = !/deactivated/i.test(name);
  const clean = name.replace(/\s*\(Deactivated User\)\s*/i, "").trim();
  if (userCache.has(clean)) return userCache.get(clean)!;
  const existing = await prisma.user.findFirst({ where: { name: clean } });
  const user =
    existing ??
    (await prisma.user.create({
      data: { name: clean, active, email: clean === "Jonathan Livi" ? "jonathan@rjlcapadvisors.com" : null },
    }));
  if (existing && active && !existing.active) await prisma.user.update({ where: { id: user.id }, data: { active: true } });
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
      await prisma.investorCriteria.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, ...crit },
        update: crit,
      });
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
      await prisma.investorCriteria.upsert({
        where: { contactId: contact.id },
        create: { contactId: contact.id, ...crit },
        update: crit,
      });
    }
    if (++n % 1000 === 0) console.log(`  contacts ${n}`);
  }
  console.log(`  contacts done: ${n} (created ${stubs} stub companies referenced only by contacts)`);
}

// ---------- deals ----------
async function importDeals() {
  const rows = readCSV("deals.csv");
  console.log(`deals.csv: ${rows.length} rows`);
  let n = 0;
  for (const r of rows) {
    const hubspotId = r["Record ID"];
    if (!hubspotId) continue;
    const name = blank(r["Deal Name"]) ?? "(Unnamed deal)";
    const [sponsorName, ...rest] = name.split(" | ");
    const propertyName = rest.length ? rest.join(" | ") : null;
    const sponsor = propertyName
      ? await prisma.company.findFirst({ where: { name: { equals: sponsorName.trim() } }, select: { id: true } })
      : null;
    const data = {
      name,
      stage: blank(r["Deal Stage"]) ?? "Deal Received",
      sponsorName: propertyName ? sponsorName.trim() : null,
      sponsorCompanyId: sponsor?.id ?? null,
      propertyName,
      propertyAddress: blank(r["Property Address"]),
      requestedAmount: num(r["Requested Equity Or Debt Amount"]) ?? num(r["Amount"]),
      totalEquity: num(r["Total Equity"]),
      ltv: num(r["Debt LTV (debt ÷ purchase price)"]),
      loanTerm: blank(r["Loan Term"]),
      equityMultiple: num(r["Equity Multiple"]),
      occupancy: num(r["Occupancy %"]),
      onMarket: r["On or Off Market?"] ? /^on/i.test(r["On or Off Market?"]) : null,
      sponsorExperience: blank(r["Describe the sponsor experience"]),
      closeDate: date(r["Close Date"]),
      ownerId: await ownerId(r["Deal owner"]),
    };
    await prisma.deal.upsert({ where: { hubspotId }, create: { hubspotId, ...data }, update: data });
    if (++n % 200 === 0) console.log(`  deals ${n}`);
  }
  console.log(`  deals done: ${n}`);
}

async function main() {
  console.log(`Importing from ${dir}`);
  await importCompanies();
  await importContacts();
  await importDeals();
  console.log("Syncing company roles down to contacts...");
  const synced = await backfillContactRoles(console.log);
  console.log(`  updated ${synced} contacts`);
  const [c, k, d, u] = await Promise.all([prisma.company.count(), prisma.contact.count(), prisma.deal.count(), prisma.user.count()]);
  console.log(`\nTotals: ${c} companies, ${k} contacts, ${d} deals, ${u} users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
