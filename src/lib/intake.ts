import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { houseText, cleanBusinessPlan } from "@/lib/style";
import { ASSET_CLASSES, US_STATES } from "@/lib/taxonomy";
import { AMORTIZATIONS, DEAL_HOLD_PERIODS, LOAN_TERMS, UNIT_MIXES } from "@/lib/taxonomy";
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
  ltv: z.number().nullable().describe("Percent, e.g. 65 (LTV or LTC)"),
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
  requestType: null, requestedAmount: null, purchasePrice: null, totalEquity: null, ltv: null, loanTerm: null, equityMultiple: null,
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
  ltv: str("LTV or LTC percent as a number (65)."),
  loanTerm: z.enum([...LOAN_TERMS, ""]).describe("Loan term, snapped to the closest option. Empty if not stated."),
  amortization: z.enum([...AMORTIZATIONS, ""]).describe("Interest-only period / amortization, snapped to the closest option. Empty if not stated."),
  expectedClose: str("Expected closing date or month as written (e.g. 'November 2026', 'Q1 2027', '45 days after PSA')."),
  equityMultiple: str("Projected equity multiple as a number (1.9)."),
  occupancy: str("Occupancy percent as a number (91)."),
  onMarket: z.enum(["on", "off", ""]).describe("on if marketed/listed, off if off-market."),
  sponsorExperience: str("Sponsor bio, 3-4 sentences: founding background, focus/strategy, scale/track record. No return figures, no dashes."),
  summary: str("Business plan for the investor email, 4-6 sentences max, flowing prose, no dashes as punctuation. Lead with location and market context, then anchor/key tenants (or the tenant/resident base), the value-add opportunity, notable physical attributes. Leave out anything that has its own field: exit strategy, return projections, dollar costs, financial metrics, seller profile, lender type, close timeline, year built, square footage, unit count."),
  details: z.object(Object.fromEntries(uniqueChecklist().filter((it) => !it.core).map((it) => [it.key, str(`${it.label}. ${it.question}${it.kind === "doc" ? " Answer Received only if the document is attached or explicitly provided." : ""}`)]))),
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
    totalEquity: n(o.totalEquity), ltv: n(o.ltv), loanTerm: t(o.loanTerm), equityMultiple: n(o.equityMultiple), occupancy: n(o.occupancy),
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
export function applyDealRules(d: ExtractedDeal): ExtractedDeal {
  const out = { ...d };
  // any equity raise that is the majority of the total equity is JV Equity
  if (out.executionType === "LP Equity" && out.requestedAmount && out.totalEquity && out.requestedAmount / out.totalEquity >= 0.5) out.executionType = "JV Equity";
  if (out.requestType === "Equity" && !out.executionType) out.executionType = "JV Equity";
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

const SYSTEM = `You extract commercial real estate deal details from emails forwarded to a capital advisory firm (RJL Capital Advisors) so the team can see what the sponsor provided and what is still missing.
Read the email (including quoted/forwarded content) and fill the schema. Rules:
- The subject line can be stale (a reply on an old thread, a forward under an old subject). Name and describe the deal from the attachments and the body; when they describe a different property than the subject, the attachments win.
- When an Excel model is attached it is the source of truth for every number (price, capitalization, debt, equity, returns, yield on cost, cap rates, unit count, square feet, occupancy): models are updated after OMs and decks are printed. Take narrative, tenants and physical description from the OM. Where the OM and the model disagree, use the model and state the difference in confidenceNotes.
- Square footage is always net rentable (NRSF, rentable area, GLA for retail); never gross building area, land or site area. Models usually show both; take the rentable figure.
- Data source priority: every number is calculated from the Excel model directly, never from the OM, deck or sponsor talking points. One exception: a figure the sponsor states in the email body itself overrides the model; use it and flag it in confidenceNotes as a sponsor override.
- LTC and LTV are almost always different numbers. Read both from the model explicitly (loan / total cost, loan / value); never assume they are equal or derive one from the other. If the model shows only one, leave the other blank and say so.
- IRR and equity multiple are deal-level: the total equity cash flow before any LP/GP split. If the model only shows split-level (LP or GP) returns, compute deal-level from the total equity line and flag it in confidenceNotes, noting the LP-level figures separately there in case an investor asks.
- Amortization comes from the model's cash flow sheet (the debt service rows); never assume it or carry it from another deal.
- Stabilized year: do not default to Year 3 for yield on cost or cash-on-cash. Read the occupancy and cash-on-cash rows by year and use the first year the asset is at or near stabilization (Year 4 or 5 on lease-up heavy deals); say which year you used in confidenceNotes.
- Model verification: when a model has several similarly labeled outputs (two different "stabilized" figures, two "total cost" cells), work out from the surrounding rows what each one divides or sums before trusting the label; when it stays ambiguous, leave the field blank and describe the ambiguity in confidenceNotes.
- Use an empty string for anything not stated. Never invent numbers or facts. No placeholders: never write "TBD", "N/A", "unknown" or a guess; leave it blank and mention it in confidenceNotes.
- Enum-like fields (seller profile, lender type, deal sourcing, lender, closing time frame): fill them only when the source documents state them explicitly. Never infer the closest match; if you are tempted to, leave it blank and say so in confidenceNotes.
- Pad sale / outparcel rule: when the deal has scheduled pad or outparcel sales during the hold that pay down basis, yield on cost at stabilization must net those proceeds out of the denominator: (Stabilized NOI excluding pad income) / (Total Capitalization minus total pad sale net proceeds). Never divide by full total cap in that case; say in confidenceNotes that the pad sale rule was applied.
- sponsorExperience is the sponsor bio: 3-4 sentences on founding background, focus/strategy, scale/track record. No return figures, no dashes.
- Style everywhere: no em dashes, en dashes or double hyphens as punctuation in any text you write. Plain sentences and commas.
- Dollar amounts are plain numbers in USD ("$12.5MM" -> 12500000, "$3,200,000" -> 3200000).
- Percentages are plain numbers (65% -> 65). LTV may appear as LTC or leverage.
- requestType: "Equity" for JV/LP/pref/co-GP equity raises, "Debt" for loans/bridge/construction/refi, "Both" if both.
- strategy: "Development" ONLY for ground-up or new construction (land or a site, a GC, a construction budget and loan, lease-up from zero, delivery dates). Everything on an existing, operating building is "Acquisitions": a purchase, a recapitalization or loan modification, a refinance, a value-add renovation, a lease-up of existing units, a capex program. A year built in the past, current occupancy, in-place rents or a T12 mean Acquisitions even if the plan spends heavily on renovations.
- unitMix, holdPeriod, loanTerm, amortization: pick the closest listed option; never write free text there. Unit counts and sizes belong in unitMix / units / squareFeet, never in the summary.
- executionType: an equity raise that is the majority of total equity is "JV Equity" (LP Equity is only a minority slice).
- expectedClose: the closing date or month if the email or model states one; otherwise empty so we ask for it.
- assetClass must be one of the listed values; map synonyms (apartments -> Multifamily, BTR -> Build-For-Rent (SFR), hotel -> Hospitality, warehouse -> Industrial, shopping center -> Retail).
- state is the two-letter code. If only a metro is given, infer the state and note it in confidenceNotes.
- For each checklist item in details: quote or closely paraphrase what the sponsor said. For documents (proforma, rent roll/T12, trade-out report, capex budget, comps) answer "Received" only if the document is attached or explicitly provided; otherwise empty.
- summary is the business plan paragraph for the investor email: lead with location and market context, then anchor/key tenants, the value-add opportunity, notable physical attributes. 4-6 sentences, flowing prose, no dashes as punctuation. Never put in the summary what has its own field: exit strategy, return projections, dollar costs, financial metrics, seller profile, lender type, close timeline, year built, square footage, unit count.`;

export async function extractWithClaude(rawText: string, subject?: string | null, attachments: string[] = []): Promise<ExtractedDeal> {
  await loadChecklist(); // the Required Items List as Jonathan last edited it
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
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
  det.sellerProfile = lineAfter(text, /seller(?: profile| is| type)?[:\s-]+([^\n]{2,80})/i);
  det.acres = lineAfter(text, /([\d.]+)\s*(?:acres?|ac\b)/i);
  det.opportunityZone = /opportunity zone|\boz\b/.test(lower) ? "Yes" : null;
  det.affordable = /affordable|lihtc|income[- ]restricted|section 8/.test(lower) ? "Yes – mentioned" : null;
  det.sourcing = d.onMarket == null ? null : d.onMarket ? "On market" : "Off market";
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
