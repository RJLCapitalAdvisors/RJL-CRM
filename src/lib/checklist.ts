/**
 * RJL's deal-ticket checklist: what we ask a sponsor for before taking a deal to market.
 * Items apply by strategy (Acquisitions / Development) and optionally by asset class.
 * Answers live on Deal.details (JSON) unless `core` points at a real Deal column.
 */

export type ItemKind = "short" | "text" | "number" | "yesno" | "doc";

export type ChecklistItem = {
  key: string;
  label: string;
  devLabel?: string; // wording override for developments
  question: string; // what we ask the sponsor / what Claude should look for
  kind: ItemKind;
  strategy: ("Acquisitions" | "Development")[];
  onlyAssetClasses?: string[]; // include only for these classes
  excludeAssetClasses?: string[]; // skip for these classes
  core?: "occupancy" | "summary" | "sponsorExperience" | "onMarket" | "ltv" | "loanTerm" | "expectedClose" | "purchasePrice" | "yieldOnCost"; // maps to a Deal column
};

const RESIDENTIAL = ["Multifamily", "Build-For-Rent (SFR)", "Student Housing", "Senior Housing", "Mixed Use"];

export const CHECKLIST: ChecklistItem[] = [
  { key: "proforma", label: "Excel underwriting model (proforma)", devLabel: "Excel underwriting model (proforma, with equity-broker fee included)", question: "Has the sponsor provided the Excel underwriting model?", kind: "doc", strategy: ["Acquisitions", "Development"] },
  { key: "rentRollT12", label: "Rent roll and T12", question: "Current rent roll and trailing-12 operating statement", kind: "doc", strategy: ["Acquisitions"], excludeAssetClasses: ["Land"] },
  { key: "occupancy", label: "Current occupancy", question: "Current physical/economic occupancy (%)", kind: "number", strategy: ["Acquisitions"], excludeAssetClasses: ["Land"], core: "occupancy" },
  { key: "leaseTradeOut", label: "Lease trade-out report", question: "Recent lease trade-out report showing new vs. expiring rents", kind: "doc", strategy: ["Acquisitions"], onlyAssetClasses: RESIDENTIAL },
  { key: "insuranceTaxes", label: "How insurance and taxes are underwritten", devLabel: "How stabilized insurance and taxes are calculated", question: "Color on how insurance and real estate taxes are underwritten (basis, reassessment, quotes)", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "yieldOnCost", label: "Yield on cost at stabilization", devLabel: "Stabilized yield on cost (stabilized NOI over total project cost)", question: "Stabilized NOI over total all-in cost, or the cap rate on all-in cost basis", kind: "number", strategy: ["Acquisitions", "Development"], excludeAssetClasses: ["Land"], core: "yieldOnCost" },
  { key: "businessPlan", label: "Business plan", question: "Explanation of the business plan (value-add, hold period, exit)", kind: "text", strategy: ["Acquisitions"], core: "summary" },
  { key: "capexBudget", label: "Capex budget", question: "Capital expenditure budget and scope", kind: "doc", strategy: ["Acquisitions"], excludeAssetClasses: ["Land"] },
  { key: "sponsorBio", label: "Sponsor bio (overall and local market experience)", question: "Sponsor track record: overall experience and experience in this market", kind: "text", strategy: ["Acquisitions", "Development"], core: "sponsorExperience" },
  { key: "landPrice", label: "Land price", question: "Land purchase price (or land basis if already owned)", kind: "number", strategy: ["Development"], core: "purchasePrice" },
  { key: "gcBio", label: "GC bio", question: "General contractor background and relevant projects", kind: "text", strategy: ["Development"] },
  { key: "gcContract", label: "Signed GC contract? GMP?", question: "Is there a signed contract with the GC and is it a guaranteed maximum price (GMP)?", kind: "short", strategy: ["Development"] },
  { key: "locationInfo", label: "Info on location", question: "Location overview: submarket, drivers, demographics", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "acres", label: "How many acres does the property sit on?", question: "Site size in acres", kind: "number", strategy: ["Acquisitions"] },
  { key: "opportunityZone", label: "Is it in an Opportunity Zone?", question: "Whether the site is in a qualified Opportunity Zone", kind: "yesno", strategy: ["Development"] },
  { key: "sourcing", label: "How the deal was sourced", devLabel: "How the land was sourced", question: "Off market, through a broker, fully on market, lightly marketed? Reason the seller is selling, the story.", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "sellerProfile", label: "Seller profile", question: "Seller type: mom and pop, institutional, family office, distressed, etc.", kind: "short", strategy: ["Acquisitions", "Development"] },
  { key: "shovelReady", label: "When will it be shovel ready?", question: "Entitlement/permitting status and expected shovel-ready date", kind: "short", strategy: ["Development"] },
  { key: "timeline", label: "Expected close", question: "Expected closing date or month (and where the deal stands now: LOI, PSA, DD, hard money)", kind: "short", strategy: ["Acquisitions", "Development"], core: "expectedClose" },
  { key: "comps", label: "Comps (rent and sales)", question: "Rent and sales comparables", kind: "doc", strategy: ["Acquisitions", "Development"] },
  { key: "constructionLoanTiming", label: "Construction loan closes with land closing, or after?", question: "Does the construction loan close simultaneously with the land closing or afterwards?", kind: "short", strategy: ["Development"] },
  { key: "debtTerms", label: "Terms of the debt", devLabel: "What debt is being used", question: "LTC/LTV, rate, interest-only period, term, amortization; term sheet if available", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "loanTerms", label: "Loan term and I/O or amortization", question: "Loan term (years) and interest-only period / amortization", kind: "short", strategy: ["Acquisitions", "Development"], core: "loanTerm" },
  { key: "lender", label: "Who is the lender?", question: "Lender type or name: Fannie/Freddie, life co, bank, debt fund, credit union", kind: "short", strategy: ["Acquisitions", "Development"] },
  { key: "affordable", label: "Any affordable housing component?", question: "Does the property qualify as affordable housing to any extent (LIHTC, income restrictions)?", kind: "short", strategy: ["Acquisitions"], onlyAssetClasses: RESIDENTIAL },
];

export function itemLabel(item: ChecklistItem, strategy?: string | null) {
  return strategy === "Development" && item.devLabel ? item.devLabel : item.label;
}

export function labelFor(key: string, strategy?: string | null) {
  const it = CHECKLIST.find((i) => i.key === key);
  return it ? itemLabel(it, strategy) : key;
}

/** Items that apply to a deal given its strategy and asset class. Unknown strategy = show everything. */
export function applicableItems(strategy: string | null | undefined, assetClass: string | null | undefined): ChecklistItem[] {
  return CHECKLIST.filter((it) => {
    if (strategy && !it.strategy.includes(strategy as "Acquisitions" | "Development")) return false;
    if (assetClass && it.onlyAssetClasses && !it.onlyAssetClasses.includes(assetClass)) return false;
    if (assetClass && it.excludeAssetClasses?.includes(assetClass)) return false;
    return true;
  });
}

export type DealLikeForChecklist = {
  strategy?: string | null;
  assetClass?: string | null;
  occupancy?: number | null;
  yieldOnCost?: number | null;
  summary?: string | null;
  sponsorExperience?: string | null;
  onMarket?: boolean | null;
  ltv?: number | null;
  loanTerm?: string | null;
  amortization?: string | null;
  expectedClose?: string | null;
  purchasePrice?: number | null;
  details?: Record<string, string | null> | string | null;
};

export function parseDetails(v: unknown): Record<string, string | null> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }
  return typeof v === "object" ? (v as Record<string, string | null>) : {};
}

/** Current answer for an item, reading the core column when the item maps to one. */
/** Wording that means the document is NOT here, however the extractor phrased it. */
export const NOT_PROVIDED = /not (?:yet )?(?:provided|included|attached|received|available|shared|sent)|no (?:excel|model|full|separate|standalone)|only (?:summary|summarized|in the (?:om|pdf|deck))|missing|to follow|will (?:send|provide|share)|pending|requested|forthcoming|n\/a/i;
/** Which file names satisfy which document item. */
export const DOC_FILE_PATTERNS: Record<string, RegExp> = {
  proforma: /\.(?:xlsx|xlsm|xls)$/i,
  rentRollT12: /rent ?roll|t-?12|trailing|operating statement|op ?stat/i,
  leaseTradeOut: /trade[- ]?out/i,
  capexBudget: /capex|capital (?:budget|expenditure)|renovation budget/i,
  comps: /\bcomps?\b|comparables/i,
};
/**
 * Make the document items honest against the files actually on hand: the Excel model counts only when an Excel
 * file is attached; any document answered with "not provided" wording is blank (so it is asked for); a file that
 * matches an item marks it Received.
 */
export function reconcileDocuments<T extends Record<string, string | null | undefined>>(details: T, fileNames: string[]): T {
  const out: Record<string, string | null | undefined> = { ...details };
  for (const it of CHECKLIST) {
    if (it.kind !== "doc") continue;
    const re = DOC_FILE_PATTERNS[it.key];
    const file = re ? fileNames.find((n) => re.test(n)) : undefined;
    if (file) {
      out[it.key] = `Received - ${file}`;
      continue;
    }
    const cur = (out[it.key] ?? "").trim();
    if (!cur) continue;
    if (it.key === "proforma") out[it.key] = ""; // no Excel file, no model, whatever the PDF summarizes
    else if (NOT_PROVIDED.test(cur)) out[it.key] = "";
  }
  return out as T;
}

export function answerFor(item: ChecklistItem, deal: DealLikeForChecklist): string | null {
  const details = parseDetails(deal.details);
  const own = item.kind === "doc" && details[item.key] && NOT_PROVIDED.test(details[item.key]!) ? null : details[item.key];
  // date and loan-term items are satisfied only by the real ticket fields, never by a free-text note
  if (own && item.core !== "expectedClose" && item.core !== "loanTerm" && item.core !== "purchasePrice") return own;
  switch (item.core) {
    case "occupancy":
      return deal.occupancy != null ? `${deal.occupancy}%` : null;
    case "yieldOnCost":
      return deal.yieldOnCost != null ? `${deal.yieldOnCost}%` : null;
    case "summary":
      return deal.summary ?? null;
    case "sponsorExperience":
      return deal.sponsorExperience ?? null;
    case "onMarket":
      return deal.onMarket == null ? null : deal.onMarket ? "On market" : "Off market";
    case "ltv":
      return deal.ltv != null ? `${deal.ltv}% LTV${deal.loanTerm ? `, ${deal.loanTerm}` : ""}` : deal.loanTerm ?? null;
    case "loanTerm":
      return deal.loanTerm ? [deal.loanTerm, deal.amortization].filter(Boolean).join(", ") : null;
    case "expectedClose":
      return deal.expectedClose ?? null;
    case "purchasePrice":
      return deal.purchasePrice != null ? `${deal.purchasePrice.toLocaleString("en-US")}` : null;
    default:
      return null;
  }
}

export function missingFor(deal: DealLikeForChecklist): ChecklistItem[] {
  return applicableItems(deal.strategy, deal.assetClass).filter((it) => !answerFor(it, deal));
}

export function completeness(deal: DealLikeForChecklist) {
  const items = applicableItems(deal.strategy, deal.assetClass);
  const answered = items.filter((it) => answerFor(it, deal)).length;
  return { answered, total: items.length };
}

/** Bulleted facts block for templates ({{deal.facts}}): every answered applicable item. */
export function factsBlock(deal: DealLikeForChecklist): string {
  return applicableItems(deal.strategy, deal.assetClass)
    .map((it) => {
      const a = answerFor(it, deal);
      if (!a) return null;
      if (it.kind === "doc") return `• ${itemLabel(it, deal.strategy)}: ${a === "Received" ? "available on request" : a}`;
      return `• ${itemLabel(it, deal.strategy)}: ${a}`;
    })
    .filter(Boolean)
    .join("\n");
}

/** Sponsor follow-up email text listing what is still missing. */
export function followUpText(deal: DealLikeForChecklist, propertyName?: string | null): string {
  const missing = missingFor(deal);
  if (!missing.length) return "";
  return `Thanks for sending ${propertyName ?? "this"} over. To take it to our capital sources we still need:\n${missing.map((it, i) => `${i + 1}. ${itemLabel(it, deal.strategy)}`).join("\n")}`;
}
