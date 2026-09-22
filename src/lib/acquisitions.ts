/**
 * RJL Acquisitions (Shawn Aziz's CRM, Sep 18, 2026): sellers, operators and buyers around properties. Same look
 * and habits as the other two sides; light yellow paper, dark blue accents (globals.css .acquisitions).
 */
/** Owner: the owner of the real estate. Operator: the business running at the property. Buyer: a group that buys. (Seller was renamed Owner on Sep 22, 2026.) */
export const AQ_ROLES = ["Owner", "Operator", "Buyer"] as const;
/** The Call Result on a property. Callback needs a target date (the dashboard's Call Me Back window); Wrong number asks which number to drop. */
export const AQ_STAGES = ["Deal", "Callback", "Not interested", "No answer", "Wrong number"] as const;
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
export const AQ_DEAL_STAGES = ["New", "Underwriting", "Offer Made", "Under Contract", "Closed", "Dead"] as const;

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
      return "bg-ink text-white";
    default:
      return "bg-cream text-ink";
  }
}

/** A company's roles flow to its people: a contact at an Operator is an Operator. Their own roles stay. */
export const mergeAqRoles = (own: string | null | undefined, company: string | null | undefined) => toJsonList([...parseJsonList(own), ...parseJsonList(company)].filter((r) => (AQ_ROLES as readonly string[]).includes(r)));

export const propertyLine = (p: { neighborhood: string | null; city: string | null; state: string | null }) => [p.neighborhood, p.city, p.state].filter(Boolean).join(", ");
export const usd = (n: number | null | undefined) => (n == null ? "" : `$${Math.round(n).toLocaleString("en-US")}`);
