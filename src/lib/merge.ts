import { fmtMoney } from "@/lib/format";
import { US_STATES } from "@/lib/taxonomy";
import { CHECKLIST, factsBlock, parseDetails, type DealLikeForChecklist } from "@/lib/checklist";

// Merge fields available in templates. Syntax: {{deal.propertyName}} or with a fallback {{contact.firstName|there}}
export const MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "contact.firstName", label: "Contact first name" },
  { key: "contact.lastName", label: "Contact last name" },
  { key: "contact.email", label: "Contact email" },
  { key: "company.name", label: "Contact's company" },
  { key: "deal.propertyName", label: "Property / deal name" },
  { key: "deal.sponsorName", label: "Sponsor" },
  { key: "deal.propertyAddress", label: "Property address" },
  { key: "deal.city", label: "City" },
  { key: "deal.state", label: "State (code)" },
  { key: "deal.stateName", label: "State (name)" },
  { key: "deal.location", label: "City, ST" },
  { key: "deal.pricePerUnit", label: "Purchase price per unit (computed)" },
  { key: "deal.pricePerFoot", label: "Purchase price per SF (computed)" },
  { key: "deal.capPerUnit", label: "Total capitalization per unit (computed)" },
  { key: "deal.capPerFoot", label: "Total capitalization per SF (computed)" },
  { key: "deal.avgUnitSize", label: "Average unit size in SF (computed)" },
  { key: "deal.assetClass", label: "Asset class" },
  { key: "deal.strategy", label: "Strategy" },
  { key: "deal.requestType", label: "Equity / Debt" },
  { key: "deal.requestedAmount", label: "Requested amount ($)" },
  { key: "deal.totalEquity", label: "Total equity ($)" },
  { key: "deal.purchasePrice", label: "Purchase price ($)" },
  { key: "deal.ltv", label: "LTV %" },
  { key: "deal.loanTerm", label: "Loan term" },
  { key: "deal.equityMultiple", label: "Equity multiple" },
  { key: "deal.occupancy", label: "Occupancy %" },
  { key: "deal.executionType", label: "Execution type (JV, Pref, Senior Debt…)" },
  { key: "deal.totalDebt", label: "Total debt ($)" },
  { key: "deal.totalCapitalization", label: "Total capitalization ($)" },
  { key: "deal.ltc", label: "LTC %" },
  { key: "deal.interestRate", label: "Interest rate" },
  { key: "deal.lenderType", label: "Lender type" },
  { key: "deal.irr", label: "IRR %" },
  { key: "deal.holdPeriod", label: "Hold period" },
  { key: "deal.yieldOnCost", label: "Yield on cost %" },
  { key: "deal.capRateY1", label: "Year 1 cap rate %" },
  { key: "deal.capRateT12", label: "T12 cap rate %" },
  { key: "deal.cashOnCash", label: "Stabilized cash-on-cash %" },
  { key: "deal.projectedReturns", label: "Projected returns (text)" },
  { key: "deal.units", label: "Units" },
  { key: "deal.squareFeet", label: "Square feet" },
  { key: "deal.yearBuilt", label: "Year built" },
  { key: "deal.unitMix", label: "Unit mix" },
  { key: "deal.expectedClose", label: "Expected close" },
  { key: "deal.summary", label: "Deal summary / business plan" },
  { key: "deal.facts", label: "Bulleted list of every answered checklist item" },
  ...CHECKLIST.filter((it) => !it.core).map((it) => ({ key: `deal.details.${it.key}`, label: it.label })),
  { key: "sender.name", label: "Sender name" },
  { key: "unsubscribeUrl", label: "Unsubscribe link" },
];

export type MergeContext = {
  contact: { firstName?: string | null; lastName?: string | null; email?: string | null };
  company?: { name?: string | null } | null;
  deal?: Record<string, unknown> | null;
  sender: { name: string };
  unsubscribeUrl: string;
};

function fmt(key: string, v: unknown): string {
  if (v == null || v === "") return "";
  if (["deal.requestedAmount", "deal.totalEquity", "deal.purchasePrice", "deal.totalDebt", "deal.totalCapitalization"].includes(key)) return fmtMoney(Number(v));
  if (["deal.ltv", "deal.ltc", "deal.occupancy", "deal.irr", "deal.yieldOnCost", "deal.capRateY1", "deal.capRateT12", "deal.cashOnCash"].includes(key)) return `${v}%`;
  if (key === "deal.units" || key === "deal.squareFeet") return Number(v).toLocaleString("en-US");
  if (key === "deal.equityMultiple") return `${v}x`;
  if (v instanceof Date) return v.toLocaleDateString("en-US");
  return String(v);
}

function lookup(ctx: MergeContext, path: string): unknown {
  if (path === "unsubscribeUrl") return ctx.unsubscribeUrl;
  if (path === "deal.facts") return ctx.deal ? factsBlock(ctx.deal as DealLikeForChecklist) : "";
  if (path.startsWith("deal.details.")) return parseDetails(ctx.deal?.details)[path.slice("deal.details.".length)] ?? "";
  if (path.startsWith("deal.") && ["pricePerUnit", "pricePerFoot", "capPerUnit", "capPerFoot", "avgUnitSize"].includes(path.slice(5))) {
    const d = ctx.deal ?? {};
    const num = (k: string) => (typeof d[k] === "number" && (d[k] as number) > 0 ? (d[k] as number) : null);
    const pp = num("purchasePrice"), tc = num("totalCapitalization"), u = num("units"), sf = num("squareFeet");
    const ratio = (a: number | null, b: number | null) => (a && b ? Math.round(a / b) : null);
    const val = { pricePerUnit: ratio(pp, u), pricePerFoot: ratio(pp, sf), capPerUnit: ratio(tc, u), capPerFoot: ratio(tc, sf), avgUnitSize: ratio(sf, u) }[path.slice(5)];
    if (val == null) return "";
    return path === "deal.avgUnitSize" ? `${val.toLocaleString("en-US")} SF` : val.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  if (path === "deal.location") return [ctx.deal?.city, ctx.deal?.state].filter(Boolean).join(", ");
  if (path === "deal.stateName") {
    const code = ctx.deal?.state as string | undefined;
    return code ? US_STATES[code] ?? code : "";
  }
  const [root, ...rest] = path.split(".");
  let cur: unknown = (ctx as Record<string, unknown>)[root];
  for (const k of rest) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
  return cur;
}

export function renderTemplate(text: string, ctx: MergeContext): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_, path: string, fallback?: string) => {
    const v = fmt(path, lookup(ctx, path));
    return v || fallback || "";
  });
}

/** Turn a plain-text body into simple HTML; pass HTML through unchanged. */
export function toHtml(body: string): string {
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  const esc = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

export function findUnknownFields(text: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) if (!known.has(m[1])) out.add(m[1]);
  return Array.from(out);
}
