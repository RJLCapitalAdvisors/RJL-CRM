import { parseList, US_STATES } from "@/lib/taxonomy";

// Which regions a state belongs to, for matching deal location against investor geography tags.
const STATE_REGIONS: Record<string, string[]> = {
  TX: ["Texas", "Sunbelt", "Southwest"],
  FL: ["Florida", "Sunbelt", "Southeast"],
  GA: ["Southeast", "Sunbelt"],
  NC: ["Southeast", "Sunbelt"],
  SC: ["Southeast", "Sunbelt"],
  TN: ["Southeast", "Sunbelt"],
  AL: ["Southeast", "Sunbelt"],
  MS: ["Southeast"],
  LA: ["Southeast", "Sunbelt"],
  AR: ["Southeast"],
  KY: ["Southeast"],
  VA: ["Mid-Atlantic", "Southeast"],
  MD: ["Mid-Atlantic"],
  DC: ["Mid-Atlantic"],
  DE: ["Mid-Atlantic"],
  WV: ["Mid-Atlantic"],
  PA: ["Northeast", "Mid-Atlantic"],
  NJ: ["Northeast", "Mid-Atlantic"],
  NY: ["Northeast"],
  CT: ["Northeast"],
  MA: ["Northeast"],
  RI: ["Northeast"],
  NH: ["Northeast"],
  VT: ["Northeast"],
  ME: ["Northeast"],
  OH: ["Midwest"],
  IN: ["Midwest"],
  IL: ["Midwest"],
  MI: ["Midwest"],
  WI: ["Midwest"],
  MN: ["Midwest"],
  IA: ["Midwest"],
  MO: ["Midwest"],
  KS: ["Midwest"],
  NE: ["Midwest"],
  SD: ["Midwest"],
  ND: ["Midwest"],
  OK: ["Southwest", "Sunbelt"],
  NM: ["Southwest", "Sunbelt"],
  AZ: ["Southwest", "Sunbelt", "Mountain West"],
  NV: ["Southwest", "Sunbelt", "Mountain West"],
  CO: ["Mountain West"],
  UT: ["Mountain West"],
  ID: ["Mountain West", "Pacific Northwest"],
  MT: ["Mountain West"],
  WY: ["Mountain West"],
  CA: ["West Coast"],
  OR: ["West Coast", "Pacific Northwest"],
  WA: ["West Coast", "Pacific Northwest"],
  AK: ["Pacific Northwest"],
  HI: ["West Coast"],
};

function parseBucket(b: string): [number, number] | null {
  const m = b.replace(/\s|\$/g, "").match(/^(\d+)(?:-(\d+))?MM\+?$/i);
  if (!m) return null;
  const lo = Number(m[1]) * 1_000_000;
  const hi = m[2] ? Number(m[2]) * 1_000_000 : Number.POSITIVE_INFINITY;
  return [lo, hi];
}

export type CriteriaLike = {
  assetClasses: string;
  checkSizes: string;
  investmentTypes: string;
  geographies: string;
  strategy: string | null;
} | null;

export type DealLike = {
  assetClass: string | null;
  state: string | null;
  requestedAmount: number | null;
  requestType: string | null;
  strategy: string | null;
};

export type MatchResult = { score: number; possible: number; reasons: string[]; misses: string[] };

/**
 * Score how well a contact's (or its company's) criteria fit a deal.
 * Each dimension the deal has data for counts one point when the criteria include it.
 * Contacts with no criteria at all score 0 but are still eligible when minScore is 0.
 */
export function matchDeal(criteria: CriteriaLike, deal: DealLike): MatchResult {
  const reasons: string[] = [];
  const misses: string[] = [];
  let possible = 0;
  if (!criteria) return { score: 0, possible: 0, reasons, misses: ["No criteria on record"] };

  if (deal.assetClass) {
    possible++;
    const ac = parseList(criteria.assetClasses);
    if (ac.includes(deal.assetClass)) reasons.push(`Asset: ${deal.assetClass}`);
    else if (ac.includes("Asset Class Agnostic")) reasons.push("Asset: agnostic");
    else misses.push("asset class");
  }

  if (deal.requestedAmount != null && deal.requestedAmount > 0) {
    possible++;
    const buckets = parseList(criteria.checkSizes).map(parseBucket).filter(Boolean) as [number, number][];
    const hit = buckets.find(([lo, hi]) => deal.requestedAmount! >= lo && deal.requestedAmount! <= hi);
    if (hit) reasons.push(`Check size fits`);
    else if (buckets.length) misses.push("check size");
    else misses.push("check size unknown");
  }

  if (deal.state) {
    possible++;
    const geos = parseList(criteria.geographies);
    const regions = STATE_REGIONS[deal.state] ?? [];
    const stateName = US_STATES[deal.state] ?? deal.state;
    if (geos.includes("Nationwide")) reasons.push("Geo: nationwide");
    else if (geos.includes(stateName)) reasons.push(`Geo: ${stateName}`);
    else {
      const r = regions.find((x) => geos.includes(x));
      if (r) reasons.push(`Geo: ${r}`);
      else misses.push("geography");
    }
  }

  if (deal.requestType) {
    possible++;
    const types = parseList(criteria.investmentTypes);
    const equity = ["JV Equity", "Co-GP Equity", "Preferred Equity"];
    const debt = ["Senior Debt", "Mezz Debt"];
    const wants = deal.requestType === "Equity" ? equity : deal.requestType === "Debt" ? debt : [...equity, ...debt];
    const hit = types.filter((t) => wants.includes(t));
    if (hit.length) reasons.push(`Type: ${hit.join(", ")}`);
    else if (types.length) misses.push("investment type");
    else misses.push("investment type unknown");
  }

  if (deal.strategy && criteria.strategy) {
    possible++;
    if (criteria.strategy === "Both" || criteria.strategy === deal.strategy) reasons.push(`Strategy: ${criteria.strategy}`);
    else misses.push("strategy");
  }

  return { score: reasons.length, possible, reasons, misses };
}
