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
  core?: "occupancy" | "summary" | "sponsorExperience" | "onMarket" | "ltv" | "loanTerm" | "expectedClose" | "purchasePrice" | "yieldOnCost" | "projectedSellout" | "selloutPerUnit" | "selloutPerFoot" | "unitMix" | "entitledFor" | "entitlementPhase" | "entitlementOutstanding" | "entitlementRisks" | "landValueCurrent" | "landValueEntitled" | "entitlementBudget" | "breakGroundDate"; // maps to a Deal column
};

const RESIDENTIAL = ["Multifamily", "Build-For-Rent (SFR)", "Student Housing", "Senior Housing", "Mixed Use"];

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { key: "proforma", label: "Excel underwriting model (proforma)", devLabel: "Excel underwriting model (proforma, with equity-broker fee included)", question: "Has the sponsor provided the Excel underwriting model?", kind: "doc", strategy: ["Acquisitions", "Development"] },
  { key: "rentRollT12", label: "Rent roll and T12", question: "Current rent roll and trailing-12 operating statement", kind: "doc", strategy: ["Acquisitions"], excludeAssetClasses: ["Land"] },
  { key: "occupancy", label: "Current occupancy", question: "Current physical/economic occupancy (%)", kind: "number", strategy: ["Acquisitions"], excludeAssetClasses: ["Land"], core: "occupancy" },
  { key: "unitMix", label: "Unit mix (bedroom types)", question: "Which bedroom types the property has (studios, 1BR, 2BR, 3BR), with counts when stated", kind: "short", strategy: ["Acquisitions", "Development"], onlyAssetClasses: [...RESIDENTIAL, "Condo"], core: "unitMix" },
  { key: "leaseTradeOut", label: "Lease trade-out report", question: "Recent lease trade-out report showing new vs. expiring rents", kind: "doc", strategy: ["Acquisitions"], onlyAssetClasses: RESIDENTIAL },
  { key: "insuranceTaxes", label: "How insurance and taxes are underwritten", devLabel: "How stabilized insurance and taxes are calculated", question: "Color on how insurance and real estate taxes are underwritten (basis, reassessment, quotes)", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "yieldOnCost", label: "Yield on cost at stabilization", devLabel: "Stabilized yield on cost (stabilized NOI over total project cost)", question: "Stabilized NOI over total all-in cost, or the cap rate on all-in cost basis", kind: "number", strategy: ["Acquisitions", "Development"], excludeAssetClasses: ["Land", "Condo"], core: "yieldOnCost" },
  // a condo sells out instead of stabilizing (Jonathan, Sep 23, 2026): the sellout figures replace yield on cost and cash on cash
  { key: "projectedSellout", label: "Projected sellout (whole dollar figure)", question: "Total projected gross sellout of all units, in whole dollars", kind: "number", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Condo"], core: "projectedSellout" },
  { key: "selloutPerUnit", label: "Average sellout per unit", question: "Average projected sale price per unit", kind: "number", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Condo"], core: "selloutPerUnit" },
  { key: "selloutPerFoot", label: "Sellout price per foot", question: "Projected sale price per sellable square foot", kind: "number", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Condo"], core: "selloutPerFoot" },
  { key: "businessPlan", label: "Business plan", question: "Explanation of the business plan (value-add, hold period, exit)", kind: "text", strategy: ["Acquisitions"], core: "summary" },
  { key: "capexBudget", label: "Capex budget", question: "Capital expenditure budget and scope", kind: "doc", strategy: ["Acquisitions"], excludeAssetClasses: ["Land"] },
  { key: "sponsorBio", label: "Sponsor bio (overall and local market experience)", question: "Sponsor track record: overall experience and experience in this market", kind: "text", strategy: ["Acquisitions", "Development"], core: "sponsorExperience" },
  { key: "landPrice", label: "Land price", question: "Land purchase price (or land basis if already owned)", kind: "number", strategy: ["Development"], core: "purchasePrice" },
  { key: "gcBio", label: "GC bio", question: "General contractor background and relevant projects", kind: "text", strategy: ["Development"] },
  { key: "gcContract", label: "Signed GC contract? GMP?", question: "Is there a signed contract with the GC and is it a guaranteed maximum price (GMP)?", kind: "short", strategy: ["Development"] },
  { key: "locationInfo", label: "Info on location", question: "Location overview: submarket, drivers, demographics", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "acres", label: "How many acres does the property sit on?", devLabel: "Land acreage (how many acres the site sits on)", question: "Site size in acres", kind: "number", strategy: ["Acquisitions", "Development"] }, // developments too (Jonathan, Sep 24, 2026: the Mann Brothers deal never asked)
  { key: "opportunityZone", label: "Is it in an Opportunity Zone?", question: "Whether the site is in a qualified Opportunity Zone", kind: "yesno", strategy: ["Development"] },
  { key: "sourcing", label: "How the deal was sourced", devLabel: "How the land was sourced", question: "Off market, through a broker, fully on market, lightly marketed? Reason the seller is selling, the story.", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "sellerProfile", label: "Seller profile", question: "Seller type: mom and pop, institutional, family office, distressed, etc.", kind: "short", strategy: ["Acquisitions", "Development"] },
  { key: "shovelReady", label: "When will it be shovel ready?", question: "Entitlement/permitting status and expected shovel-ready date", kind: "short", strategy: ["Development"] },
  { key: "timeline", label: "Critical dates (expected close; LOI, PSA, due diligence and hard money dates)", question: "The critical dates: expected closing date or month, and where the deal stands now (LOI, PSA, due diligence, hard money) with their dates", kind: "short", strategy: ["Acquisitions", "Development"], core: "expectedClose" },
  { key: "comps", label: "Comps (rent and sales)", question: "Rent and sales comparables", kind: "doc", strategy: ["Acquisitions", "Development"] },
  { key: "constructionLoanTiming", label: "Construction loan closes with land closing, or after?", question: "Does the construction loan close simultaneously with the land closing or afterwards?", kind: "short", strategy: ["Development"] },
  { key: "debtTerms", label: "Terms of the debt", devLabel: "What debt is being used", question: "LTC/LTV, rate, interest-only period, term, amortization; term sheet if available", kind: "text", strategy: ["Acquisitions", "Development"] },
  { key: "loanTerms", label: "Loan term and I/O or amortization", question: "Loan term (years) and interest-only period / amortization", kind: "short", strategy: ["Acquisitions", "Development"], core: "loanTerm" },
  { key: "lender", label: "Who is the lender?", question: "Lender type or name: Fannie/Freddie, life co, bank, debt fund, credit union", kind: "short", strategy: ["Acquisitions", "Development"] },
  // land entitlement deals (Jonathan, Oct 6, 2026; Cudjoe Key): what the deals@ list asks a sponsor entitling land
  { key: "entitledFor", label: "What use the land is being entitled for (asset class)", question: "The asset class the land is being entitled for (multifamily, industrial, hospitality, mixed use) and the density or program sought", kind: "short", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "entitledFor" },
  { key: "entitledUnderwriting", label: "Underwriting for the entitled phase (program, buildable units or SF, land value per unit or per buildable foot, exit)", question: "How the entitled land is underwritten: the program (units or buildable square feet), the land value per unit or per buildable foot once entitled, and the exit (sale to a developer, joint venture, or build)", kind: "text", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"] },
  { key: "entitlementPhase", label: "Current entitlement phase and outstanding entitlement items (where the approvals stand today and what is still needed)", question: "Where the entitlement stands today (pre-application, application filed, hearings, approvals in hand, permits) and every approval, hearing, permit, study or agreement still needed before the land is fully entitled", kind: "text", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "entitlementPhase" },
  { key: "entitlementRisks", label: "Walk through the entitlement risks as of today (opposition, zoning, environmental, infrastructure, timing)", question: "The entitlement risks as of today: neighborhood or political opposition, zoning or comprehensive plan changes needed, environmental and wetlands, utilities and access, timing", kind: "text", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "entitlementRisks" },
  { key: "entitlementTimeline", label: "Entitlement timeline (hearing dates and expected approval date)", question: "The hearing schedule and the expected date of full entitlement", kind: "short", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"] },
  { key: "breakGroundDate", label: "Break ground date (when construction starts once entitled)", question: "When construction is expected to start once the land is entitled, as a month and year or a quarter", kind: "short", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "breakGroundDate" },
  { key: "landValueCurrent", label: "Current value of the unentitled land (as-is, whole dollars; appraisal or broker opinion)", question: "The as-is value of the land today, unentitled, in whole dollars, and where the number comes from (appraisal, broker opinion, recent purchase price)", kind: "number", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "landValueCurrent" },
  { key: "landValueEntitled", label: "Value of the land once entitled (whole dollars, with the basis for the number)", question: "The value of the land once fully entitled, in whole dollars, and the basis for it (comps, per-unit or per-buildable-foot land values, a developer's offer)", kind: "number", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "landValueEntitled" },
  { key: "entitlementBudget", label: "Total entitlement budget (consultants, legal, fees, studies and carry, whole dollars)", question: "The total budget to get the land entitled: consultants, legal, application fees, studies, carry, in whole dollars", kind: "number", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"], core: "entitlementBudget" },
  { key: "carryCosts", label: "Carry costs during entitlement (taxes, insurance, interest) per year", question: "What it costs to hold the land each year while it is entitled: taxes, insurance, interest", kind: "short", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"] },
  { key: "sellerStory", label: "Seller story and profile (who the seller is, how long they have held the land and why they are selling now)", question: "Who the seller is (mom and pop, family office, institution, lender), how long they have held the land, and why they are selling now", kind: "text", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"] },
  { key: "landComps", label: "Land comps (entitled and unentitled land sales)", question: "Comparable land sales, entitled and unentitled, with price per acre or per buildable unit", kind: "doc", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"] },
  { key: "exitPlan", label: "Exit once entitled (sell to a developer, joint venture, or build)", question: "What happens once the land is entitled: sale to a developer, a joint venture, or building it out", kind: "short", strategy: ["Acquisitions", "Development"], onlyAssetClasses: ["Land"] },
  { key: "affordable", label: "Any affordable housing component?", question: "Does the property qualify as affordable housing to any extent (LIHTC, income restrictions)?", kind: "short", strategy: ["Acquisitions"], onlyAssetClasses: RESIDENTIAL },
];

/**
 * The live list. It starts as DEFAULT_CHECKLIST and becomes Jonathan's Required Items List once loadChecklist()
 * (src/lib/required-items.ts) has read it from the database; every function below reads this array.
 */
export const CHECKLIST: ChecklistItem[] = [...DEFAULT_CHECKLIST];
export function setChecklist(items: ChecklistItem[]) {
  CHECKLIST.splice(0, CHECKLIST.length, ...items);
}
/** Each key once (the same item can sit in several windows with different asset classes). */
export function uniqueChecklist(items: ChecklistItem[] = CHECKLIST): ChecklistItem[] {
  const seen = new Set<string>();
  return items.filter((it) => (seen.has(it.key) ? false : (seen.add(it.key), true)));
}

export function itemLabel(item: ChecklistItem, strategy?: string | null) {
  return strategy === "Development" && item.devLabel ? item.devLabel : item.label;
}

export function labelFor(key: string, strategy?: string | null) {
  const it = CHECKLIST.find((i) => i.key === key);
  return it ? itemLabel(it, strategy) : key;
}

/** Items that apply to a deal given its strategy and asset class. Unknown strategy = show everything. */
const DEBT_ITEMS = new Set(["debtTerms", "loanTerms", "lender", "constructionLoanTiming"]);
export function applicableItems(strategy: string | null | undefined, assetClass: string | null | undefined, opts: { unlevered?: boolean | null } = {}): ChecklistItem[] {
  // no strategy on the ticket yet: the acquisitions list, never both. Development only when someone said so
  // (Bethesda, Sep 16: a null strategy handed the sponsor the development questions).
  const strat = strategy || "Acquisitions";
  return uniqueChecklist(
    CHECKLIST.filter((it) => {
      if (!it.strategy.includes(strat as "Acquisitions" | "Development")) return false;
      if (assetClass && it.onlyAssetClasses && !it.onlyAssetClasses.includes(assetClass)) return false;
      if (assetClass && it.excludeAssetClasses?.includes(assetClass)) return false;
      if (opts.unlevered && DEBT_ITEMS.has(it.key)) return false; // no senior debt, nothing to ask about it
      return true;
    }),
  );
}

export type DealLikeForChecklist = {
  strategy?: string | null;
  assetClass?: string | null;
  occupancy?: number | null;
  yieldOnCost?: number | null;
  projectedSellout?: number | null;
  selloutPerUnit?: number | null;
  selloutPerFoot?: number | null;
  unitMix?: string | null;
  summary?: string | null;
  sponsorExperience?: string | null;
  onMarket?: boolean | null;
  ltv?: number | null;
  loanTerm?: string | null;
  amortization?: string | null;
  expectedClose?: string | null;
  purchasePrice?: number | null;
  entitledFor?: string | null;
  entitlementPhase?: string | null;
  entitlementOutstanding?: string | null;
  entitlementRisks?: string | null;
  landValueCurrent?: number | null;
  landValueEntitled?: number | null;
  entitlementBudget?: number | null;
  breakGroundDate?: string | null;
  unlevered?: boolean | null;
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
  landComps: /land (?:comps?|sales?)|\bcomps?\b|comparables/i,
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
    case "projectedSellout":
      return deal.projectedSellout != null ? `$${deal.projectedSellout.toLocaleString("en-US")}` : null;
    case "selloutPerUnit":
      return deal.selloutPerUnit != null ? `$${deal.selloutPerUnit.toLocaleString("en-US")} per unit` : null;
    case "selloutPerFoot":
      return deal.selloutPerFoot != null ? `$${deal.selloutPerFoot.toLocaleString("en-US")} per SF` : null;
    case "unitMix":
      return deal.unitMix ?? null;
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
      return deal.purchasePrice != null ? `$${deal.purchasePrice.toLocaleString("en-US")}` : null;
    case "entitledFor":
      return deal.entitledFor ?? null;
    case "entitlementPhase":
      return [deal.entitlementPhase, deal.entitlementOutstanding].filter(Boolean).join("; ") || null; // one ask covers the phase and what is still outstanding
    case "breakGroundDate":
      return deal.breakGroundDate ?? null;
    case "entitlementOutstanding":
      return deal.entitlementOutstanding ?? null;
    case "entitlementRisks":
      return deal.entitlementRisks ?? null;
    case "landValueCurrent":
      return deal.landValueCurrent != null ? `$${deal.landValueCurrent.toLocaleString("en-US")}` : null;
    case "landValueEntitled":
      return deal.landValueEntitled != null ? `$${deal.landValueEntitled.toLocaleString("en-US")}` : null;
    case "entitlementBudget":
      return deal.entitlementBudget != null ? `$${deal.entitlementBudget.toLocaleString("en-US")}` : null;
    default:
      return null;
  }
}

export function missingFor(deal: DealLikeForChecklist): ChecklistItem[] {
  return applicableItems(deal.strategy, deal.assetClass, { unlevered: deal.unlevered }).filter((it) => !answerFor(it, deal));
}

export function completeness(deal: DealLikeForChecklist) {
  const items = applicableItems(deal.strategy, deal.assetClass, { unlevered: deal.unlevered });
  const answered = items.filter((it) => answerFor(it, deal)).length;
  return { answered, total: items.length };
}

/** Bulleted facts block for templates ({{deal.facts}}): every answered applicable item. */
export function factsBlock(deal: DealLikeForChecklist): string {
  return applicableItems(deal.strategy, deal.assetClass, { unlevered: deal.unlevered })
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
