// Controlled vocabularies for RJL Capital Advisors and normalizers that map
// messy HubSpot values onto them. Unknown values are kept (trimmed) so nothing is lost.

export const ROLES = ["Sponsor", "Investor", "Retail Investor", "Lender", "Broker"] as const;
export type Role = (typeof ROLES)[number];

export const ASSET_CLASSES = [
  "Multifamily",
  "Build-For-Rent (SFR)",
  "Student Housing",
  "Senior Housing",
  "Retail",
  "Industrial",
  "Office",
  "Medical Office",
  "Office/Flex",
  "Mixed Use",
  "Hospitality",
  "Self Storage",
  "Land",
  "Build To Suit",
  "Notes (Distressed Debt)",
  "Asset Class Agnostic",
] as const;

export const CHECK_SIZES = ["$1-5MM", "$5-10MM", "$10-15MM", "$15-20MM", "$20-30MM", "$30-50MM", "$50MM+"] as const;
export const DEAL_SIZES = ["$1-5MM", "$5-10MM", "$10-20MM", "$20-50MM", "$50MM+"] as const;
export const INVESTMENT_TYPES = ["JV Equity", "Co-GP Equity", "Preferred Equity", "Senior Debt", "Mezz Debt"] as const;
export const STRATEGIES = ["Development", "Acquisitions", "Both"] as const;
export const VINTAGES = ["<1960's", "1960's", "1970's", "1980's", "1990's", "2000's", "2010's", "New Construction"] as const;

export const DEAL_STAGES = [
  "Deal Mentioned",
  "Deal Received",
  "Deal Underwritten",
  "Deal Taken To Market",
  "Intro To Capital Made",
  "Term Sheet Issued",
  "Term Sheet Signed",
  "Deal Closed",
  "Deal Lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const ACTIVE_STAGES = DEAL_STAGES.filter((s) => s !== "Deal Closed" && s !== "Deal Lost");

export const REGIONS = [
  "Nationwide",
  "Sunbelt",
  "Southeast",
  "Southwest",
  "Midwest",
  "Northeast",
  "Mid-Atlantic",
  "Mountain West",
  "West Coast",
  "Pacific Northwest",
  "Texas",
  "Florida",
] as const;

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "Washington DC",
};

// ---------- helpers ----------

export function parseList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function toJson(list: string[]): string {
  return JSON.stringify(Array.from(new Set(list.filter(Boolean))));
}

export function splitMulti(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function canon(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9+<]/g, "");
}

function mapWith(values: string[], vocab: readonly string[], aliases: Record<string, string>): string[] {
  const byCanon = new Map<string, string>();
  for (const v of vocab) byCanon.set(canon(v), v);
  for (const [k, v] of Object.entries(aliases)) byCanon.set(canon(k), v);
  const out: string[] = [];
  for (const v of values) {
    const hit = byCanon.get(canon(v));
    out.push(hit ?? v);
  }
  return Array.from(new Set(out));
}

export function normalizeRoles(...raws: (string | undefined | null)[]): string[] {
  const values = raws.flatMap(splitMulti);
  return mapWith(values, ROLES, {
    "Retail Investors": "Retail Investor",
    Investors: "Investor",
    Sponsors: "Sponsor",
    Lenders: "Lender",
    Brokers: "Broker",
  }).filter((r) => (ROLES as readonly string[]).includes(r));
}

export function normalizeAssetClasses(raw: string | undefined | null): string[] {
  return mapWith(splitMulti(raw), ASSET_CLASSES, {
    Agnostic: "Asset Class Agnostic",
    "Asset Agnostic": "Asset Class Agnostic",
    "Built For Rent (SFR)": "Build-For-Rent (SFR)",
    "Single Family Residential (BFR)": "Build-For-Rent (SFR)",
    "Single Family Residential": "Build-For-Rent (SFR)",
    BFR: "Build-For-Rent (SFR)",
    SFR: "Build-For-Rent (SFR)",
    "Mixed Use (multifamily/retail)": "Mixed Use",
    "Mixed-Use": "Mixed Use",
    "Medical-Office": "Medical Office",
    "Medical Office Building": "Medical Office",
    "Build To Suit Investor/Lender": "Build To Suit",
    "Notes": "Notes (Distressed Debt)",
    "Distressed Debt": "Notes (Distressed Debt)",
    "Self-Storage": "Self Storage",
    Storage: "Self Storage",
    Hotel: "Hospitality",
    Hotels: "Hospitality",
    "Senior Living": "Senior Housing",
    "Student": "Student Housing",
  });
}

export function normalizeCheckSizes(raw: string | undefined | null): string[] {
  const values = splitMulti(raw).map((v) => v.replace(/\s+/g, "").replace(/^(?!\$)/, "$"));
  return mapWith(values, CHECK_SIZES, {});
}

export function normalizeDealSizes(raw: string | undefined | null): string[] {
  const values = splitMulti(raw).map((v) => v.replace(/\s+/g, "").replace(/^(?!\$)/, "$"));
  return mapWith(values, DEAL_SIZES, {});
}

export function normalizeInvestmentTypes(raw: string | undefined | null): string[] {
  return mapWith(splitMulti(raw), INVESTMENT_TYPES, {
    "Co GP Equity": "Co-GP Equity",
    "CoGP": "Co-GP Equity",
    "Pref Equity": "Preferred Equity",
    "Preferred": "Preferred Equity",
    "Mezzanine": "Mezz Debt",
    "Mezz": "Mezz Debt",
    "Senior Loan": "Senior Debt",
    "Debt": "Senior Debt",
    "LP Equity": "JV Equity",
    "JV": "JV Equity",
  });
}

export function normalizeStrategy(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("both")) return "Both";
  if (v.startsWith("dev")) return "Development";
  if (v.startsWith("acq")) return "Acquisitions";
  return raw!.trim();
}

export function normalizeVintages(raw: string | undefined | null): string[] {
  return mapWith(splitMulti(raw), VINTAGES, { "Pre 1960": "<1960's", "New Build": "New Construction" });
}

// Free-text geography ("nationwide", "Sunbelt, TX", "Midwest. No FL") -> tags.
// Negations are not interpreted; the raw text is preserved in geographyNotes for the reader.
export function normalizeGeographies(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const text = raw.toLowerCase();
  const tags = new Set<string>();

  const regionHints: [RegExp, string][] = [
    [/na+tion\s*wide|national\b|agnostic|anywhere|all markets|us\b|united states|top \d+ msa/, "Nationwide"],
    [/sun\s*belt|southern growth/, "Sunbelt"],
    [/south\s*east|carolinas|atlanta|atl\b|nashville|charlotte|georgia|tennessee/, "Southeast"],
    [/south\s*west|phoenix|arizona|las vegas|nevada|new mexico/, "Southwest"],
    [/mid\s*west|chicago|ohio|indiana|michigan|wisconsin|minnesota|kansas city|st\.? louis/, "Midwest"],
    [/north\s*east|new england|boston|nyc|new york|ny\b|new jersey|nj\b|philadelphia|tri-?state/, "Northeast"],
    [/mid\s*-?\s*atlantic|dc\b|washington d\.?c|maryland|virginia|dmv/, "Mid-Atlantic"],
    [/mountain|denver|colorado|utah|salt lake|idaho|boise/, "Mountain West"],
    [/west coast|california|socal|southern california|los angeles|bay area|san diego/, "West Coast"],
    [/pacific north\s*west|seattle|portland|washington state|oregon/, "Pacific Northwest"],
    [/texas|tx\b|dallas|dfw|houston|austin|san antonio/, "Texas"],
    [/florida|fl\b|miami|tampa|orlando|jacksonville|south florida/, "Florida"],
  ];
  for (const [re, tag] of regionHints) if (re.test(text)) tags.add(tag);

  // Bare state codes and names
  for (const [code, name] of Object.entries(US_STATES)) {
    if (new RegExp(`\\b${code}\\b`).test(raw) || text.includes(name.toLowerCase())) tags.add(name);
  }
  return Array.from(tags);
}

export function roleColor(role: string): string {
  switch (role) {
    case "Sponsor":
      return "bg-ink text-white";
    case "Investor":
      return "bg-sky text-ink";
    case "Retail Investor":
      return "bg-sky/50 text-ink";
    case "Lender":
      return "bg-amber-200 text-ink";
    case "Broker":
      return "bg-stone-200 text-ink";
    default:
      return "bg-stone-100 text-ink";
  }
}

export function stageTone(stage: string): string {
  switch (stage) {
    case "Deal Closed":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "Deal Lost":
      return "bg-stone-100 text-stone-600 border-stone-200";
    case "Term Sheet Signed":
    case "Term Sheet Issued":
      return "bg-sky text-ink border-sky";
    default:
      return "bg-cream text-ink border-line";
  }
}
