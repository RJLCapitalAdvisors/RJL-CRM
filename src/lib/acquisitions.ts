/**
 * RJL Acquisitions (Shawn Aziz's CRM, Sep 18, 2026): sellers, operators and buyers around properties. Same look
 * and habits as the other two sides; light yellow paper, dark blue accents (globals.css .acquisitions).
 */
/** Owner: the owner of the real estate. Operator: the business running at the property. Buyer: a group that buys. (Seller was renamed Owner on Sep 22, 2026.) */
export const AQ_ROLES = ["Owner", "Operator", "Buyer"] as const;
/** The Call Result on a property. Callback needs a target date (the dashboard's Call Me Back window); Wrong number asks which number to drop. */
export const AQ_STAGES = ["Deal", "Callback", "Not interested", "No answer", "Wrong number", "Skipped"] as const;
/** Why a number is junk (Oct 5, 2026): the two reasons Shawn's call lists use; anything else may be typed. */
export const AQ_JUNK_PHONE_REASONS = ["Wrong number", "Bad number"] as const;
export const AQ_ASSET_TYPES = ["Free-standing", "Strip center", "Other"] as const;
/** Where an operator stands with us (Jonathan, Sep 22, 2026). */
export const AQ_OPERATOR_STATUSES = ["Pipeline", "Corporate", "Not interested"] as const;
/** Lines of a one-per-line field (Other Phones, Emails), bullets and blanks stripped. */
export const lines = (s: string | null | undefined): string[] => (s ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean);
/** "1234 Bedford Ave" becomes "1234 Bedford Ave LLC"; a name that already ends in an entity suffix is left alone. */
export const ensureLlc = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  return /\b(llc|l\.l\.c\.|inc\.?|corp\.?|co\.?|l\.?p\.?|llp|ltd\.?|trust|company|corporation|partners(hip)?|associates|holdings|realty|properties)$/i.test(t) ? t : `${t} LLC`;
};
export const digitsOf = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");
/** Pipeline columns for properties marked Deal. Placeholders until Jonathan and Shawn settle the stages. */
export const AQ_DEAL_STAGES = ["New Deal", "Underwriting", "Offer Made", "Under Contract", "Closed", "Dead"] as const;
/**
 * Three pipelines on the Acquisitions side (Jonathan, Sep 23, 2026): Buyers and Operators hold contacts with that role,
 * Deals holds properties whose Call Result carries Deal. Each has its own stages, kept as data in a Setting and edited
 * from its board; these are the placeholders until the first edit.
 */
export const AQ_BUYER_STAGES = ["New", "Contacted", "Qualified", "Touring", "Offer Made", "Closed", "Dead"] as const;
export const AQ_OPERATOR_STAGES = ["New", "Contacted", "Interested", "Negotiating", "Signed", "Dead"] as const;
export type AqPipeline = "buyers" | "operators" | "deals";
export const AQ_PIPELINES: Record<AqPipeline, { label: string; noun: string; setting: string; defaults: readonly string[]; field: "buyerStage" | "operatorStage" | "dealStage"; role: "Buyer" | "Operator" | null }> = {
  buyers: { label: "Buyers Pipeline", noun: "buyer", setting: "aqBuyerStages", defaults: AQ_BUYER_STAGES, field: "buyerStage", role: "Buyer" },
  operators: { label: "Operators Pipeline", noun: "operator", setting: "aqOperatorStages", defaults: AQ_OPERATOR_STAGES, field: "operatorStage", role: "Operator" },
  deals: { label: "Deal Pipeline", noun: "deal", setting: "aqDealStages", defaults: AQ_DEAL_STAGES, field: "dealStage", role: null },
};
export const AQ_PIPELINE_ORDER: AqPipeline[] = ["buyers", "operators", "deals"];
export const isAqPipeline = (s: string | undefined): s is AqPipeline => s === "buyers" || s === "operators" || s === "deals";

export const parseJsonList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
export const toJsonList = (v: readonly string[]) => JSON.stringify([...new Set(v)]);

export const aqFullName = (c: { firstName: string | null; lastName: string | null; email: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(no name)";

export function aqRoleColor(role: string): string {
  switch (role) {
    case "Owner":
    case "Seller":
      return "bg-amber-200 text-ink";
    case "Operator":
      return "bg-ink text-white";
    case "Buyer":
      return "bg-emerald-100 text-emerald-900";
    default:
      return "bg-cream text-ink";
  }
}
export function aqStageTone(stage: string): string {
  switch (stage) {
    case "Deal":
      return "bg-ink text-white";
    case "Callback":
      return "bg-amber-200 text-ink";
    case "Not interested":
      return "bg-red-100 text-red-800";
    case "No answer":
      return "bg-cream text-muted";
    case "Wrong number":
      return "bg-slate-200 text-slate-800";
    case "Skipped":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-cream text-ink";
  }
}
export function aqDealStageTone(stage: string | null | undefined): string {
  switch (stage) {
    case "Closed":
      return "bg-emerald-100 text-emerald-900";
    case "Dead":
      return "bg-red-100 text-red-800";
    case "Under Contract":
    case "Signed":
      return "bg-ink text-white";
    default:
      return "bg-cream text-ink";
  }
}

/** A company's roles flow to its people: a contact at an Operator is an Operator. Their own roles stay. */
export const mergeAqRoles = (own: string | null | undefined, company: string | null | undefined) => toJsonList([...parseJsonList(own), ...parseJsonList(company)].filter((r) => (AQ_ROLES as readonly string[]).includes(r)));

/**
 * The same town however the export spells it (Oct 5, 2026): "Brick", "Brick Township", "Brick Twp" and
 * "Brick Township, NJ 08723" all become "brick". Lowercase, the state and zip after a comma dropped, township,
 * borough, city of and the like dropped, punctuation out.
 */
export function normalizeTown(s: string | null | undefined): string {
  let t = (s ?? "").toLowerCase().split(",")[0].trim();
  t = t.replace(/d{5}(-d{4})?/g, " ");
  t = t.replace(/^(city|town|township|village|borough|boro)s+ofs+/g, "");
  t = t.replace(/(township|twp.?|borough|boro.?|village|city|town)/g, " ");
  return t.replace(/[^a-z0-9 ]+/g, " ").replace(/s+/g, " ").trim();
}
const STREET_WORDS: Record<string, string> = { street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", boulevard: "blvd", lane: "ln", court: "ct", place: "pl", highway: "hwy", route: "rte", rt: "rte", parkway: "pkwy", terrace: "ter", circle: "cir", turnpike: "tpke", north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th" };
/** The same street address however it is written: "123 Main Street, Unit 4" and "123 MAIN ST #4" match. Suites and units are dropped. */
export function normalizeAddress(s: string | null | undefined): string {
  let t = (s ?? "").toLowerCase().split(",")[0];
  t = t.replace(/s*(#|suite|ste.?|unit|apt.?|floor|fl.?)s*[w-]*s*$/g, " ");
  t = t.replace(/[^a-z0-9 ]+/g, " ");
  return t.split(/s+/).filter(Boolean).map((w) => STREET_WORDS[w] ?? w).join(" ");
}
export const normalizePhone = (s: string | null | undefined) => { const d = digitsOf(s); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };

export const propertyLine = (p: { neighborhood: string | null; city: string | null; state: string | null }) => [p.neighborhood, p.city, p.state].filter(Boolean).join(", ");
export const usd = (n: number | null | undefined) => (n == null ? "" : `$${Math.round(n).toLocaleString("en-US")}`);
