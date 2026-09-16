import Anthropic from "@anthropic-ai/sdk";
import { FORMAT_RULES, loadUnderwritingRules } from "@/lib/underwriting-rules";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { houseText, cleanBusinessPlan } from "@/lib/style";
import { ASSET_CLASSES, US_STATES } from "@/lib/taxonomy";
import { AMORTIZATIONS, DEAL_HOLD_PERIODS, LOAN_TERMS, SELLER_PROFILES, SOURCING_OPTIONS, UNIT_MIXES } from "@/lib/taxonomy";

/** Detail fields that are dropdowns on the deal ticket: the extractor picks one of the options or leaves the field blank. Sentences about sourcing or the seller belong in the notes, not here. */
const ENUM_DETAILS: Record<string, readonly string[]> = { sourcing: SOURCING_OPTIONS, sellerProfile: SELLER_PROFILES };
import { uniqueChecklist, missingFor, type DealLikeForChecklist } from "@/lib/checklist";
import { loadChecklist } from "@/lib/required-items";

export const ExtractedDealSchema = z.object({
  sponsorName: z.string().nullable().describe("Company sponsoring / acquiring the deal (not the broker or forwarder)"),
  propertyName: z.string().nullable(),
  propertyAddress: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable().describe("Two-letter US state code"),
  assetClass: z.string().nullable().describe(`One of: ${ASSET_CLASSES.join(", ")}`),
  strategy: z.enum(["Acquisitions", "Development"]).nullable(),
  requestType: z.enum(["Equity", "Debt", "Both"]).nullable(),
  requestedAmount: z.number().nullable().describe("US dollars, e.g. 12000000"),
  purchasePrice: z.number().nullable().describe("Purchase price or total project cost in USD"),
  totalEquity: z.number().nullable(),
  ltv: z.number().nullable().describe("Percent: total debt over purchase price"),
  ltc: z.number().nullable().describe("Percent: total debt over total capitalization"),
  loanTerm: z.string().nullable(),
  equityMultiple: z.number().nullable(),
  occupancy: z.number().nullable().describe("Percent"),
  onMarket: z.boolean().nullable(),
  sponsorExperience: z.string().nullable().describe("Sponsor bio, 3-4 sentences: founding background, focus/strategy, scale/track record. No return figures, no dashes."),
  summary: z.string().nullable().describe("Business plan for the investor email, 4-6 sentences max, flowing prose, no dashes as punctuation. Lead with location and market context, then anchor/key tenants (or the tenant/resident base), the value-add opportunity, notable physical attributes. Leave out anything that has its own field: exit strategy, return projections, dollar costs, financial metrics, seller profile, lender type, close timeline, year built, square footage, unit count."),
  details: z.record(z.string(), z.string().nullable()).describe("Checklist answers by Required Items List key"),
  // underwriting snapshot
  units: z.number().nullable(),
  squareFeet: z.number().nullable(),
  yearBuilt: z.string().nullable(),
  unitMix: z.string().nullable(),
  totalCapitalization: z.number().nullable(),
  totalDebt: z.number().nullable(),
  executionType: z.string().nullable(),
  interestRate: z.string().nullable(),
  lenderType: z.string().nullable(),
  irr: z.number().nullable(),
  capRateT12: z.number().nullable(),
  capRateY1: z.number().nullable(),
  yieldOnCost: z.number().nullable(),
  cashOnCash: z.number().nullable(),
  holdPeriod: z.string().nullable(),
  expectedClose: z.string().nullable(),
  amortization: z.string().nullable(),
  contactName: z.string().nullable().describe("Name of the person who sent the deal"),
  contactEmail: z.string().nullable(),
  confidenceNotes: z.string().nullable().describe("Anything ambiguous or inferred"),
});
export type ExtractedDeal = z.infer<typeof ExtractedDealSchema>;

export const EMPTY: ExtractedDeal = {
  sponsorName: null, propertyName: null, propertyAddress: null, city: null, state: null, assetClass: null, strategy: null,
  requestType: null, requestedAmount: null, purchasePrice: null, totalEquity: null, ltv: null, ltc: null, loanTerm: null, equityMultiple: null,
  occupancy: null, onMarket: null, sponsorExperience: null, summary: null,
  details: {} as ExtractedDeal["details"],
  units: null, squareFeet: null, yearBuilt: null, unitMix: null, totalCapitalization: null, totalDebt: null, executionType: null, interestRate: null,
  lenderType: null, irr: null, capRateT12: null, capRateY1: null, yieldOnCost: null, cashOnCash: null, holdPeriod: null, expectedClose: null, amortization: null,
  contactName: null, contactEmail: null, confidenceNotes: null,
};

export function toChecklistDeal(d: ExtractedDeal): DealLikeForChecklist {
  return { strategy: d.strategy, assetClass: d.assetClass, occupancy: d.occupancy, summary: d.summary, sponsorExperience: d.sponsorExperience, onMarket: d.onMarket, ltv: d.ltv, loanTerm: d.loanTerm, amortization: d.amortization, expectedClose: d.expectedClose, purchasePrice: d.purchasePrice, details: d.details as Record<string, string | null> };
}

/** Keys of checklist items still unanswered, given the deal's strategy and asset class. */
export function missingItems(d: ExtractedDeal): string[] {
  return missingFor(toChecklistDeal(d)).map((it) => it.key);
}

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------- Claude extraction ----------
// The API limits structured-output schemas to 16 nullable/union fields, so Claude returns plain
// strings ("" = unknown) and we convert to the typed ExtractedDeal afterwards.
const str = (desc: string) => z.string().describe(desc + " Empty string if not stated.");
// built when called, so it carries the Required Items List as Jonathan last edited it
const claudeOutput = () => z.object({
  sponsorName: str("Company sponsoring / acquiring the deal (not the broker or forwarder)."),
  propertyName: str("Property or deal name."),
  propertyAddress: str("Street address."),
  city: str("City."),
  state: str("Two-letter US state code."),
  assetClass: z.enum([...ASSET_CLASSES, ""]).describe("Asset class, or empty."),
  strategy: z.enum(["Acquisitions", "Development", ""]).describe("Development ONLY for ground-up / new construction. An existing building being bought, recapitalized, refinanced, renovated or leased up is Acquisitions."),
  requestType: z.enum(["Equity", "Debt", "Both", ""]).describe("Equity for JV/LP/pref/co-GP raises; Debt for loans/bridge/construction/refi."),
  requestedAmount: str("Requested amount in US dollars, digits only (12500000)."),
  purchasePrice: str("Acquisitions: purchase price. Developments: the LAND price only (never the total project cost). US dollars, digits only."),
  totalEquity: str("Total equity in US dollars, digits only."),
  ltv: str("LTV percent as a number: total debt over purchase price (65). Never the LTC."),
  ltc: str("LTC percent as a number: total debt over total capitalization. Computed on its own from the model's numbers; almost never equal to the LTV."),
  loanTerm: z.enum([...LOAN_TERMS, ""]).describe("Loan term, snapped to the closest option. Empty if not stated."),
  amortization: z.enum([...AMORTIZATIONS, ""]).describe("Interest-only period / amortization, snapped to the closest option. Empty if not stated."),
  expectedClose: str("Expected closing date or month as written (e.g. 'November 2026', 'Q1 2027', '45 days after PSA')."),
  equityMultiple: str("Projected equity multiple as a number (1.9)."),
  occupancy: str("Occupancy percent as a number (91)."),
  onMarket: z.enum(["on", "off", ""]).describe("on if marketed/listed, off if off-market."),
  sponsorExperience: str("Sponsor bio, 3-4 sentences: founding background, focus/strategy, scale/track record. No return figures, no dashes."),
  summary: str("Business plan for the investor email, 4-6 sentences max, flowing prose, no dashes as punctuation. Lead with location and market context, then anchor/key tenants (or the tenant/resident base), the value-add opportunity, notable physical attributes. Leave out anything that has its own field: exit strategy, return projections, dollar costs, financial metrics, seller profile, lender type, close timeline, year built, square footage, unit count."),
  details: z.object(
    Object.fromEntries(
      uniqueChecklist()
        .filter((it) => !it.core)
        .map((it) => [
          it.key,
          ENUM_DETAILS[it.key]
            ? z.enum(["", ...ENUM_DETAILS[it.key]] as [string, ...string[]]).describe(`${it.label}: exactly one of the listed options, only when the documents say so plainly. Otherwise "". Never a sentence.`)
            : str(`${it.label}. ${it.question}${it.kind === "doc" ? " Answer Received only if the document is attached or explicitly provided." : ""}`),
        ]),
    ),
  ),
  units: str("Number of units, keys (hotel) or beds (student housing), digits only."),
  squareFeet: str("Net rentable square feet (NRSF / rentable area / GLA for retail), digits only. Never gross building area, gross SF, land or site area, or lot size; if only a gross figure is given, leave this blank and say so in confidenceNotes."),
  yearBuilt: str("Year built or vintage range."),
  unitMix: z.enum([...UNIT_MIXES, ""]).describe("Which bedroom types the property has, snapped to the closest option (counts and sizes do NOT go here). Empty if not stated."),
  totalCapitalization: str("Total capitalization / total project cost in US dollars, digits only."),
  totalDebt: str("Total debt in US dollars, digits only."),
  executionType: z.enum(["JV Equity", "LP Equity", "Co-GP Equity", "Preferred Equity", "Senior Debt", "Mezz Debt", "Fund Investment", ""]).describe("Position in the capital stack being raised. Any equity raise that is the majority of total equity is JV Equity; LP Equity only for a minority slice."),
  interestRate: str("Debt interest rate as written (6.1% fixed, SOFR + 300)."),
  lenderType: str("Lender or lender type (agency/Freddie/Fannie, bank, debt fund, life co, CMBS) ONLY when the documents state it; never inferred."),
  irr: str("Projected IRR percent as a number (18.4)."),
  capRateT12: str("T12 / trailing / going-in cap rate percent as a number."),
  capRateY1: str("Year 1 cap rate percent as a number."),
  yieldOnCost: str("Yield on cost, percent as a number, ALWAYS filled when the material allows: stabilized NOI over total all-in cost (total capitalization). Models label it yield on cost, return on cost, stabilized yield, cap rate on all-in cost, cap rate on total cost, or untrended/trended yield; take the stabilized figure if shown, else the going-in cap rate on all-in cost, else compute it from stabilized (or year 3) NOI and total capitalization and say so in confidenceNotes. If pad/outparcel sales pay down basis during the hold: stabilized NOI excluding pad income divided by (total capitalization minus total pad sale net proceeds). Development deals: stabilized NOI over total project cost."),
  cashOnCash: str("Stabilized cash-on-cash percent as a number."),
  holdPeriod: z.enum([...DEAL_HOLD_PERIODS, ""]).describe("Hold period snapped to the closest option (a 3.2-year hold is '3 year'). Empty if not stated."),
  contactName: str("Name of the person who sent the deal."),
  contactEmail: str("Email of the person who sent the deal."),
  confidenceNotes: str("Anything ambiguous, inferred, left blank for lack of a source, or where a special rule (pad sale) was applied."),
});
type ClaudeOutput = z.infer<ReturnType<typeof claudeOutput>>;

function fromClaude(o: ClaudeOutput): ExtractedDeal {
  const n = (v: string) => {
    const t = v.replace(/[^0-9.-]/g, "");
    if (!t) return null;
    const x = Number(t);
    return isNaN(x) ? null : x;
  };
  const t = (v: string) => houseText((v.trim() ? v.trim() : null));
  const details = Object.fromEntries(Object.entries(o.details).map(([k, v]) => [k, t(v as string)])) as ExtractedDeal["details"];
  const out: ExtractedDeal = {
    sponsorName: t(o.sponsorName), propertyName: t(o.propertyName), propertyAddress: t(o.propertyAddress), city: t(o.city),
    state: t(o.state)?.toUpperCase() ?? null, assetClass: t(o.assetClass), strategy: (t(o.strategy) as ExtractedDeal["strategy"]) ?? null,
    requestType: (t(o.requestType) as ExtractedDeal["requestType"]) ?? null, requestedAmount: n(o.requestedAmount), purchasePrice: n(o.purchasePrice),
    totalEquity: n(o.totalEquity), ltv: n(o.ltv), ltc: n(o.ltc), loanTerm: t(o.loanTerm), equityMultiple: n(o.equityMultiple), occupancy: n(o.occupancy),
    onMarket: o.onMarket === "on" ? true : o.onMarket === "off" ? false : null, sponsorExperience: t(o.sponsorExperience), summary: cleanBusinessPlan(t(o.summary)),
    details, contactName: t(o.contactName), contactEmail: t(o.contactEmail), confidenceNotes: t(o.confidenceNotes),
    units: n(o.units), squareFeet: n(o.squareFeet), yearBuilt: t(o.yearBuilt), unitMix: t(o.unitMix), totalCapitalization: n(o.totalCapitalization),
    totalDebt: n(o.totalDebt), executionType: t(o.executionType), interestRate: t(o.interestRate), lenderType: t(o.lenderType), irr: n(o.irr),
    capRateT12: n(o.capRateT12), capRateY1: n(o.capRateY1), yieldOnCost: n(o.yieldOnCost), cashOnCash: n(o.cashOnCash), holdPeriod: t(o.holdPeriod),
    expectedClose: t(o.expectedClose), amortization: t(o.amortization),
  };
  // an operating building is never a development, whatever the renovation budget says
  const existingBuilding = (out.occupancy != null && out.occupancy > 0) || (out.capRateT12 != null && out.capRateT12 > 0) || (out.yearBuilt != null && /\b(19\d\d|20[01]\d|202[0-4])\b/.test(String(out.yearBuilt)));
  if (out.strategy === "Development" && existingBuilding) {
    out.strategy = "Acquisitions";
    out.confidenceNotes = [out.confidenceNotes, "Strategy set to Acquisitions: the material describes an existing, operating building (year built / occupancy / T12), not ground-up construction."].filter(Boolean).join(" ");
  }
  return out;
}

/** House rules applied after extraction, whichever extractor ran. */
/**
 * The requested equity amount is always a round number, the way it is said out loud: "$12MM", "$3.5MM". Whole
 * millions from $5MM up, half millions below (Jonathan's underwriting rules, Sep 16).
 */
export function roundAsk(amount: number): number {
  const step = amount >= 5_000_000 ? 1_000_000 : 500_000;
  return Math.max(step, Math.round(amount / step) * step);
}

export function applyDealRules(d: ExtractedDeal): ExtractedDeal {
  const out = { ...d };
  // any equity raise that is the majority of the total equity is JV Equity
  if (out.executionType === "LP Equity" && out.requestedAmount && out.totalEquity && out.requestedAmount / out.totalEquity >= 0.5) out.executionType = "JV Equity";
  if (out.requestType === "Equity" && !out.executionType) out.executionType = "JV Equity";
  // Underwriting rule (Jonathan, Sep 15 and 16): the requested equity amount is 90% of the total equity in the deal, as a round number
  const equity = out.totalEquity ?? (out.totalCapitalization != null && out.totalDebt != null && out.totalCapitalization > out.totalDebt ? out.totalCapitalization - out.totalDebt : null);
  if (out.requestType !== "Debt" && equity && equity > 0) {
    out.requestedAmount = roundAsk(equity * 0.9);
    if (out.totalEquity == null) out.totalEquity = equity;
  } else if (out.requestType !== "Debt" && out.requestedAmount) {
    out.requestedAmount = roundAsk(out.requestedAmount); // no equity figure to work from: at least make the stated ask a round number
  }
  // LTV is debt over price, LTC is debt over total capitalization, each on its own when the model left it out
  const pct = (a: number, b: number) => Math.round((a / b) * 10000) / 100;
  if (out.ltv == null && out.totalDebt && out.purchasePrice && out.strategy !== "Development") out.ltv = pct(out.totalDebt, out.purchasePrice);
  if (out.ltc == null && out.totalDebt && out.totalCapitalization) out.ltc = pct(out.totalDebt, out.totalCapitalization);
  // developments: occupancy, year built and cap rates do not apply; a "price" equal to total cost is not a land price
  if (out.strategy === "Development") {
    if (out.purchasePrice != null && out.totalCapitalization != null && Math.abs(out.purchasePrice - out.totalCapitalization) < 1000) out.purchasePrice = null;
    out.occupancy = null;
    out.yearBuilt = null;
    out.capRateT12 = null;
    out.capRateY1 = null;
  }
  return out;
}

/**
 * The extractor's instructions: the house underwriting rules as saved under Settings > Underwriting rules (one
 * bullet each), then the format rules the schema depends on. Editing the page changes the next extraction.
 */
function systemPrompt(rules: string[]): string {
  return [
    "You extract commercial real estate deal details from emails forwarded to a capital advisory firm (RJL Capital Advisors) so the team can see what the sponsor provided and what is still missing.",
    "Read the email (including quoted/forwarded content) and fill the schema.",
    "",
    "House underwriting rules (from the team; follow every one):",
    ...rules.map((r) => `- ${r}`),
    "",
    "Format rules:",
    ...FORMAT_RULES.map((r) => `- ${r}`),
  ].join("\n");
}

export async function extractWithClaude(rawText: string, subject?: string | null, attachments: string[] = []): Promise<ExtractedDeal> {
  await loadChecklist(); // the Required Items List as Jonathan last edited it
  const rules = await loadUnderwritingRules(); // Settings > Underwriting rules, as last saved
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: systemPrompt(rules),
    messages: [{ role: "user", content: `Subject: ${subject ?? ""}\nAttachments: ${attachments.length ? attachments.join(", ") : "(none)"}\n\n${rawText}` }],
    output_config: { format: zodOutputFormat(claudeOutput()) },
  });
  if (response.stop_reason === "refusal") throw new Error("Extraction was refused by the model");
  if (!response.parsed_output) throw new Error("Model returned no structured output");
  return fromClaude(response.parsed_output);
}

// ---------- Heuristic fallback (no API key) ----------
const money = (s: string): number | null => {
  const m = s.match(/\$\s?([\d,.]+)\s*(mm|m|million|k|bn|b)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "mm" || unit === "m" || unit === "million") n *= 1_000_000;
  else if (unit === "k") n *= 1_000;
  else if (unit === "bn" || unit === "b") n *= 1_000_000_000;
  return n;
};
const pctAfter = (text: string, re: RegExp): number | null => {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return isNaN(n) ? null : n;
};
const lineAfter = (text: string, re: RegExp): string | null => {
  const m = text.match(re);
  return m ? m[1].trim().slice(0, 300) : null;
};

export function extractHeuristic(rawText: string, subject?: string | null, fromName?: string | null, fromEmail?: string | null, attachments: string[] = []): ExtractedDeal {
  const text = rawText.replace(/\r/g, "");
  const lower = text.toLowerCase();
  const d: ExtractedDeal = { ...EMPTY, details: { ...EMPTY.details }, contactName: fromName ?? null, contactEmail: fromEmail ?? null };

  const acMap: [RegExp, string][] = [
    [/multifamily|multi-family|apartment|\bunits\b/, "Multifamily"],
    [/build[- ]to[- ]rent|\bbtr\b|\bsfr\b|single[- ]family/, "Build-For-Rent (SFR)"],
    [/student housing/, "Student Housing"],
    [/senior (housing|living)|assisted living/, "Senior Housing"],
    [/self[- ]storage/, "Self Storage"],
    [/hotel|hospitality|resort/, "Hospitality"],
    [/industrial|warehouse|logistics|distribution/, "Industrial"],
    [/medical office|\bmob\b/, "Medical Office"],
    [/office/, "Office"],
    [/retail|shopping center|strip center|grocery/, "Retail"],
    [/mixed[- ]use/, "Mixed Use"],
    [/\bland\b|entitled/, "Land"],
  ];
  d.assetClass = acMap.find(([re]) => re.test(lower))?.[1] ?? null;
  d.strategy = /development|ground[- ]up|construction loan|entitle|shovel/.test(lower) ? "Development" : /acqui|purchase|under contract|\bpsa\b/.test(lower) ? "Acquisitions" : null;
  const debt = /\b(loan|debt|bridge|refinanc|lender|ltv|ltc|senior|mezz)\b/.test(lower);
  const equity = /\b(equity|jv|lp|co-?gp|pref(erred)?|raise)\b/.test(lower);
  d.requestType = debt && equity ? "Both" : debt ? "Debt" : equity ? "Equity" : null;

  const req = text.match(/(?:seeking|raising|looking for|requesting|need|request(?:ed)?|loan amount|equity (?:raise|need|request))[^$\n]{0,40}(\$\s?[\d,.]+\s*(?:mm|m|million|k)?)/i);
  d.requestedAmount = req ? money(req[1]) : null;
  const pp = text.match(/(?:purchase price|acquisition price|total (?:project )?cost|price)[^$\n]{0,30}(\$\s?[\d,.]+\s*(?:mm|m|million|k)?)/i);
  d.purchasePrice = pp ? money(pp[1]) : null;
  const te = text.match(/(?:total equity|equity required|equity check)[^$\n]{0,30}(\$\s?[\d,.]+\s*(?:mm|m|million|k)?)/i);
  d.totalEquity = te ? money(te[1]) : null;
  d.ltv = pctAfter(text, /(\d{2}(?:\.\d+)?)\s*%\s*(?:ltv|ltc|leverage)/i) ?? pctAfter(text, /(?:ltv|ltc|leverage)[^\d\n]{0,15}(\d{2}(?:\.\d+)?)\s*%/i);
  d.occupancy = pctAfter(text, /(\d{2,3}(?:\.\d+)?)\s*%\s*(?:occupied|occupancy|leased)/i) ?? pctAfter(text, /(?:occupancy|occupied|leased)[^\d\n]{0,15}(\d{2,3}(?:\.\d+)?)\s*%/i);
  const em = text.match(/(\d(?:\.\d+)?)\s*x\s*(?:equity multiple|em\b|multiple)/i) ?? text.match(/(?:equity multiple|multiple)[^\d\n]{0,15}(\d(?:\.\d+)?)\s*x/i);
  d.equityMultiple = em ? Number(em[1]) : null;
  d.loanTerm = lineAfter(text, /(?:loan term|term)[:\s-]+([^\n]{2,60})/i);
  d.onMarket = /off[- ]market/.test(lower) ? false : /on[- ]market|listed with|broker(ed)? by/.test(lower) ? true : null;
  d.propertyAddress = lineAfter(text, /(\d{2,6}\s+[A-Za-z0-9.'\- ]{3,40}\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway|Ct|Court|Pl|Place)\b[^\n]{0,60})/);
  for (const [code, name] of Object.entries(US_STATES)) {
    if (new RegExp(`\\b${code}\\b`).test(text) || lower.includes(name.toLowerCase())) {
      d.state = code;
      break;
    }
  }
  const cityState = text.match(/([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?),\s*([A-Z]{2})\b/);
  if (cityState) {
    d.city = cityState[1];
    d.state = d.state ?? cityState[2];
  }
  d.sponsorName =
    lineAfter(text, /(?:sponsor|borrower|developer|buyer)[:\s-]+([^\n,.]{2,60})/i)
      ?.replace(/\s+(?:is|are|has|have|we)\b.*$/i, "")
      .trim() || null;
  d.propertyName = subject?.replace(/^(fwd?|re|fw):\s*/gi, "").trim() || null;
  d.sponsorExperience = lineAfter(text, /(?:track record|experience|has (?:developed|acquired|completed))[^\n]{0,5}[:\s-]*([^\n]{5,200})/i);

  const det = d.details as Record<string, string | null>;
  det.timeline = lineAfter(text, /(?:clos(?:e|ing)|timeline|hard money|due diligence)[^\n]{0,10}[:\s-]+([^\n]{2,80})/i);
  det.lender = lineAfter(text, /(?:lender|financing (?:from|by)|loan from)[:\s-]+(?:an?\s+)?([^\n,.]{2,60})/i);
  const debtLine = lineAfter(text, /((?:\d{2}%\s*(?:LTV|LTC)|(?:bridge|construction|senior|agency|permanent) loan|debt:)[^\n]{0,160})/i);
  det.debtTerms = debtLine ?? (d.ltv != null ? `${d.ltv}% LTV${d.loanTerm ? ", " + d.loanTerm : ""}` : null);
  det.acres = lineAfter(text, /([\d.]+)\s*(?:acres?|ac\b)/i);
  det.opportunityZone = /opportunity zone|\boz\b/.test(lower) ? "Yes" : null;
  det.affordable = /affordable|lihtc|income[- ]restricted|section 8/.test(lower) ? "Yes – mentioned" : null;
  det.sourcing = d.onMarket == null ? null : d.onMarket ? "on-market" : "completely off-market";
  const docs: [string, RegExp][] = [
    ["proforma", /pro ?forma|underwriting model|\.xlsx?/i],
    ["rentRollT12", /rent roll|t-?12|trailing[- ]12/i],
    ["leaseTradeOut", /trade[- ]out/i],
    ["capexBudget", /capex|capital (?:expenditure|budget)/i],
    ["comps", /\bcomps?\b|comparables/i],
  ];
  const attachText = attachments.join(" ");
  for (const [k, re] of docs) if (re.test(attachText) || /attached|see attached|enclosed/.test(lower) && re.test(text)) det[k] = "Received";
  d.summary = null;
  d.confidenceNotes = "Parsed with the basic pattern matcher (no Claude API key configured). Please verify every field.";
  return d;
}

export async function extractDeal(rawText: string, subject?: string | null, fromName?: string | null, fromEmail?: string | null, attachments: string[] = []): Promise<{ data: ExtractedDeal; extractor: string }> {
  if (claudeConfigured()) {
    try {
      const data = await extractWithClaude(rawText, subject, attachments);
      return { data: { ...data, contactName: data.contactName ?? fromName ?? null, contactEmail: data.contactEmail ?? fromEmail ?? null }, extractor: "claude" };
    } catch (e) {
      const data = extractHeuristic(rawText, subject, fromName, fromEmail, attachments);
      data.confidenceNotes = `Claude extraction failed (${String(e).slice(0, 200)}). Fell back to the basic pattern matcher; verify every field.`;
      return { data, extractor: "heuristic" };
    }
  }
  return { data: extractHeuristic(rawText, subject, fromName, fromEmail, attachments), extractor: "heuristic" };
}
