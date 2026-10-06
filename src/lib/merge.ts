import { US_STATES } from "@/lib/taxonomy";
import { cleanBusinessPlan } from "@/lib/style";
import { uniqueChecklist, factsBlock, parseDetails, type DealLikeForChecklist } from "@/lib/checklist";
import { dealMetricsListHtml, entitledUse, intro, landMetricsHtml, metricsHtml, subjectLine, usd } from "@/lib/deal-copy";
import { prefMetrics } from "@/lib/pref";
import { rateNumber, rateText } from "@/lib/rates";

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
  { key: "deal.avgUnitSize", label: "Average unit size (number only; write SF after it)" },
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
  { key: "deal.interestRate", label: "Rate: \"300 bps over SOFR (6.90% today)\" on a floating loan, \"6.75%\" when fixed" },
  { key: "deal.rateIndex", label: "Rate index (SOFR, Prime, 10 Year Treasury)" },
  { key: "deal.rateSpread", label: "Spread over the index, e.g. \"300 bps\"" },
  { key: "deal.indicativeRate", label: "Indicative rate today (index + spread), e.g. \"6.90%\"" },
  { key: "deal.lenderType", label: "Lender type" },
  { key: "deal.irr", label: "IRR %" },
  { key: "deal.holdPeriod", label: "Hold period" },
  { key: "deal.yieldOnCost", label: "Yield on cost %" },
  { key: "deal.capRateY1", label: "Year 1 cap rate %" },
  { key: "deal.capRateT12", label: "T12 cap rate %" },
  { key: "deal.cashOnCash", label: "Stabilized cash-on-cash %" },
  { key: "deal.projectedSellout", label: "Projected sellout ($, condo)" },
  { key: "deal.selloutPerUnit", label: "Average sellout per unit ($, condo)" },
  { key: "deal.selloutPerFoot", label: "Sellout price per foot ($, condo)" },
  { key: "deal.projectedReturns", label: "Projected returns (text)" },
  { key: "deal.units", label: "Units" },
  { key: "deal.squareFeet", label: "Square feet" },
  { key: "deal.yearBuilt", label: "Year built" },
  { key: "deal.unitMix", label: "Unit mix" },
  { key: "deal.expectedClose", label: "Expected close" },
  { key: "deal.summary", label: "Deal summary / business plan" },
  { key: "deal.subjectLine", label: "House-style subject: Asset Acquisition Opportunity in City, ST | $X of JV Equity" },
  { key: "deal.intro", label: "House-style intro paragraph (adapts to asset class and development vs acquisition)" },
  { key: "deal.metrics", label: "Deal Metrics bullet list (per foot / per unit as the asset class calls for)" },
  { key: "deal.lastDollar", label: "Last dollar exposure (pref/mezz)" },
  { key: "deal.prefLtc", label: "Pref LTC %" },
  { key: "deal.prefLtv", label: "Pref LTV %" },
  { key: "deal.goingInYieldLD", label: "Going-in yield on last dollar %" },
  { key: "deal.stabilizedYieldLD", label: "Stabilized yield on last dollar %" },
  { key: "deal.basisLD", label: "Stabilized basis on last pref dollar (per foot | per unit on a condo)" },
  { key: "deal.facts", label: "Bulleted list of every answered checklist item" },
  // land entitlement (Jonathan, Oct 6, 2026)
  { key: "deal.entitledFor", label: "Entitled for (asset class, land)" },
  { key: "deal.entitledUse", label: "The use as a heading word: \"Hotel\" for Hospitality (land)" },
  { key: "deal.breakGroundDate", label: "Break ground date (land)" },
  { key: "deal.entitlementPhase", label: "Current entitlement phase (land)" },
  { key: "deal.entitlementOutstanding", label: "Outstanding entitlement items (land)" },
  { key: "deal.entitlementRisks", label: "Entitlement risks as of today (land)" },
  { key: "deal.landValueCurrent", label: "Current value of the unentitled land ($)" },
  { key: "deal.landValueEntitled", label: "Value of the land once entitled ($)" },
  { key: "deal.entitlementBudget", label: "Total entitlement budget ($)" },
  { key: "deal.landValuePerAcre", label: "Current land value per acre (computed)" },
  { key: "deal.entitledValuePerAcre", label: "Entitled land value per acre (computed)" },
  { key: "deal.valueUplift", label: "Entitled value over current value, e.g. \"2.40x\" (computed)" },
  { key: "deal.prefLtvEntitled", label: "Pref LTV on entitled land value % (land)" },
  { key: "deal.entitledCover", label: "Entitled value cover of the last dollar, e.g. \"1.80x\" (land)" },
  { key: "deal.unlevered", label: "\"Unlevered\" when the deal carries no senior debt, else blank" },
  { key: "deal.landMetrics", label: "Land Metrics bullet list: values, budget, sources and uses, the pref or senior loan request (land)" },
  { key: "deal.dealMetrics", label: "Deal Metrics bullet list without the heading (land: the entitled plan, approvals, exit, returns)" },
  ...uniqueChecklist().filter((it) => !it.core).map((it) => ({ key: `deal.details.${it.key}`, label: it.label })),
  { key: "openingLine", label: "Personal opening line (set per recipient in deal outreach)" },
  { key: "sender.name", label: "Sender name" },
  { key: "unsubscribeUrl", label: "Unsubscribe link" },
];

export type MergeContext = {
  contact: { firstName?: string | null; lastName?: string | null; email?: string | null };
  company?: { name?: string | null } | null;
  deal?: Record<string, unknown> | null;
  sender: { name: string };
  unsubscribeUrl: string;
  openingLine?: string | null;
};

function fmt(key: string, v: unknown): string {
  if (key === "deal.summary" && typeof v === "string") return cleanBusinessPlan(v) ?? ""; // the business plan never carries fielded facts, however old the ticket
  if (v == null || v === "") return "";
  if (key === "deal.strategy" && v === "Acquisitions") return "Acquisition"; // "Multifamily Acquisition Opportunity in …" (Jonathan, Oct 1, 2026)
  if (["deal.requestedAmount", "deal.totalEquity", "deal.purchasePrice", "deal.totalDebt", "deal.totalCapitalization", "deal.projectedSellout", "deal.selloutPerUnit", "deal.landValueCurrent", "deal.landValueEntitled", "deal.entitlementBudget"].includes(key)) return usd(Number(v));
  if (key === "deal.unlevered") return v === true ? "Unlevered" : "";
  if (key === "deal.selloutPerFoot") return `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (["deal.ltv", "deal.ltc", "deal.occupancy", "deal.irr", "deal.yieldOnCost", "deal.capRateY1", "deal.capRateT12", "deal.cashOnCash"].includes(key)) return `${v}%`;
  if (key === "deal.units" || key === "deal.squareFeet") return Number(v).toLocaleString("en-US");
  if (v instanceof Date) return v.toLocaleDateString("en-US");
  return String(v);
}

function lookup(ctx: MergeContext, path: string): unknown {
  if (path === "unsubscribeUrl") return ctx.unsubscribeUrl;
  if (path === "openingLine") return ctx.openingLine ?? "";
  if (path === "deal.facts") return ctx.deal ? factsBlock(ctx.deal as DealLikeForChecklist) : "";
  if (path === "deal.landMetrics") return ctx.deal ? landMetricsHtml(ctx.deal) : "";
  if (path === "deal.entitledUse") return ctx.deal ? entitledUse(ctx.deal) ?? "" : "";
  if (path === "deal.dealMetrics") return ctx.deal ? dealMetricsListHtml(ctx.deal) : "";
  if (["deal.landValuePerAcre", "deal.entitledValuePerAcre", "deal.valueUplift"].includes(path)) {
    const d = ctx.deal ?? {};
    const acres = Number(parseDetails(d.details).acres ?? "") || null;
    const now = typeof d.landValueCurrent === "number" ? d.landValueCurrent : null;
    const ent = typeof d.landValueEntitled === "number" ? d.landValueEntitled : null;
    if (path === "deal.landValuePerAcre") return now && acres ? usd(now / acres) : "";
    if (path === "deal.entitledValuePerAcre") return ent && acres ? usd(ent / acres) : "";
    return now && ent ? `${(ent / now).toFixed(2)}x` : "";
  }
  if (["deal.lastDollar", "deal.prefLtc", "deal.prefLtv", "deal.prefLtvEntitled", "deal.entitledCover", "deal.goingInYieldLD", "deal.stabilizedYieldLD", "deal.basisLD"].includes(path)) {
    if (!ctx.deal) return "";
    const pm = prefMetrics(ctx.deal);
    const k = path.slice(5) as keyof typeof pm;
    const v = pm[k];
    if (v == null || typeof v !== "number") return "";
    if (k === "lastDollar") return usd(v);
    if (k === "entitledCover") return `${v.toFixed(2)}x`;
    if (k === "basisLD") return `${usd(v)} per ${pm.basisUnit}${pm.basisPerUnitLD ? ` | ${usd(pm.basisPerUnitLD)} per unit` : ""}`;
    return `${v.toFixed(2)}%`;
  }
  if (path === "deal.interestRate") return ctx.deal ? rateText(ctx.deal as never) ?? "" : "";
  if (path === "deal.rateSpread") return ctx.deal?.rateSpreadBps != null ? `${ctx.deal.rateSpreadBps} bps` : "";
  if (path === "deal.indicativeRate") { const n = ctx.deal ? rateNumber(ctx.deal as never) : null; return n != null ? `${n.toFixed(2)}%` : ""; }
  if (path === "deal.subjectLine") return ctx.deal ? subjectLine(ctx.deal) : "";
  if (path === "deal.intro") return ctx.deal ? intro(ctx.deal) : "";
  if (path === "deal.metrics") return ctx.deal ? metricsHtml(ctx.deal) : "";
  if (path.startsWith("deal.details.")) return parseDetails(ctx.deal?.details)[path.slice("deal.details.".length)] ?? "";
  if (path.startsWith("deal.") && ["pricePerUnit", "pricePerFoot", "capPerUnit", "capPerFoot", "avgUnitSize"].includes(path.slice(5))) {
    const d = ctx.deal ?? {};
    const num = (k: string) => (typeof d[k] === "number" && (d[k] as number) > 0 ? (d[k] as number) : null);
    const pp = num("purchasePrice"), tc = num("totalCapitalization"), u = num("units"), sf = num("squareFeet");
    const ratio = (a: number | null, b: number | null) => (a && b ? Math.round(a / b) : null);
    const val = { pricePerUnit: ratio(pp, u), pricePerFoot: ratio(pp, sf), capPerUnit: ratio(tc, u), capPerFoot: ratio(tc, sf), avgUnitSize: ratio(sf, u) }[path.slice(5)];
    if (val == null) return "";
    if (path === "deal.avgUnitSize") return val.toLocaleString("en-US"); // the templates write "SF" after it (it read "850 SF SF"; Jonathan, Oct 1, 2026)
    const exact = { pricePerFoot: pp && sf ? pp / sf : null, capPerFoot: tc && sf ? tc / sf : null }[path.slice(5) as "pricePerFoot" | "capPerFoot"];
    return exact != null ? `$${exact.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : val.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

/**
 * Fill the merge fields. With `mark`, every deal field is wrapped in an element carrying data-deal="<field>", so an email
 * that was saved and edited by hand can still take the ticket's latest numbers (the Send deal page swaps those elements
 * on every open; Jonathan, Sep 24, 2026). Marks only go into html bodies, never a subject line.
 */
export function renderTemplate(text: string, ctx: MergeContext, opts?: { mark?: boolean }): string {
  const mark = Boolean(opts?.mark) && /<[a-z][\s\S]*>/i.test(text);
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_, path: string, fallback?: string) => {
    const v = fmt(path, lookup(ctx, path)) || fallback || "";
    if (!mark || !path.startsWith("deal.")) return v;
    const tag = /^\s*<(ul|ol|p|div|table)/i.test(v) ? "div" : "span";
    return `<${tag} data-deal="${path}">${v}</${tag}>`;
  });
}

/** Put the ticket's current values into an email that was saved earlier: each marked element is replaced by its fresh twin. Null when the saved html carries no marks. */
export function refreshDealFields(savedHtml: string, freshHtml: string): string | null {
  const re = /<(span|div) data-deal="([^"]+)">/g;
  const freshOf = new Map<string, string>();
  for (const m of freshHtml.matchAll(re)) {
    const end = closeOf(freshHtml, m.index! + m[0].length, m[1]);
    if (end >= 0) freshOf.set(m[2], freshHtml.slice(m.index!, end));
  }
  let out = "", at = 0, hits = 0;
  for (const m of savedHtml.matchAll(re)) {
    if (m.index! < at) continue; // a mark inside one already replaced
    const end = closeOf(savedHtml, m.index! + m[0].length, m[1]);
    const fresh = freshOf.get(m[2]);
    if (end < 0 || fresh == null) continue;
    out += savedHtml.slice(at, m.index!) + fresh;
    at = end;
    hits++;
  }
  return hits ? out + savedHtml.slice(at) : null;
}
/** Index just past the close tag that matches an open <tag> whose contents start at `from`. */
function closeOf(html: string, from: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/**
 * The template editor stores one <div> per line (what contentEditable produces) and an empty <div><br></div> for
 * a blank line. In the email those become paragraphs: each non-empty top-level div is a <p>, empty ones are
 * dropped (the paragraph margin is the spacing). Anything that is not editor output passes through untouched.
 */
export function editorBlocksToParagraphs(html: string): string {
  const t = html.trim();
  if (!/^<div[\s>]/i.test(t)) return html;
  const blocks: string[] = [];
  let depth = 0, start = -1;
  const re = /<\/?div\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(t))) {
    const closing = m[0].startsWith("</");
    if (!closing) {
      if (depth === 0) {
        if (m.index > last && t.slice(last, m.index).trim()) blocks.push(t.slice(last, m.index)); // stray text between blocks
        start = m.index + m[0].length;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) {
        blocks.push(t.slice(start, m.index));
        last = m.index + m[0].length;
        start = -1;
      }
    }
  }
  if (last < t.length && t.slice(last).trim()) blocks.push(t.slice(last));
  return blocks
    .map((b) => b.replace(/^(\s|&nbsp;|<br\s*\/?>)+|(\s|&nbsp;|<br\s*\/?>)+$/gi, ""))
    .filter((b) => b.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim() || /<(img|ul|ol|table)/i.test(b))
    .map((b) => (/^<(p|ul|ol|table|h[1-6])\b/i.test(b) ? b : `<p>${b}</p>`))
    .join("\n");
}

/** Turn a plain-text body into simple HTML; editor output into paragraphs; other HTML passes through unchanged. */
export function toHtml(body: string): string {
  if (/^\s*<div[\s>]/i.test(body)) return editorBlocksToParagraphs(body);
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

/** Plain-text version of an HTML (or plain) body, for mailto links and Outlook drafts. */
export function toText(body: string): string {
  if (!/<[a-z][\s\S]*>/i.test(body)) return body.trim();
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const UNSUBSCRIBE_FOOTER = `<p style="font-size:12px;color:#6b716e">If you'd prefer not to receive emails from RJL Capital Advisors, <a href="{{unsubscribeUrl}}">unsubscribe here</a>.</p>`;
