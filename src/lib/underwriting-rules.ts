import { prisma } from "@/lib/db";

/**
 * The house underwriting rules the deals@ extractor reads on every email. They live in the CRM under Settings >
 * Underwriting rules (one rule per line) so Jonathan and Aviel can see what the extractor is working from; when a
 * deal comes out wrong, the fix is a new or sharper line here. Code seeds the page with the rules given so far and
 * uses them until the page has been saved once. Format rules the schema depends on stay in code (FORMAT_RULES),
 * and so do the formulas that must never drift (BUILT_IN_RULES describes them for the page).
 */
export const SETTING_KEY = "underwritingRules";

export const DEFAULT_UNDERWRITING_RULES: string[] = [
  "The subject line can be stale (a reply on an old thread, a forward under an old subject). Name and describe the deal from the attachments and the body; when they describe a different property than the subject, the attachments win.",
  "When an Excel model is attached it is the source of truth for every number (price, capitalization, debt, equity, returns, yield on cost, cap rates, unit count, square feet, occupancy): models are updated after OMs and decks are printed. Take narrative, tenants and physical description from the OM. Where the OM and the model disagree, use the model and state the difference in confidenceNotes.",
  "Square footage is always net rentable (NRSF, rentable area, GLA for retail); never gross building area, land or site area. Models usually show both; take the rentable figure.",
  "Data source priority: every number is calculated from the Excel model directly, never from the OM, deck or sponsor talking points. One exception: a figure the sponsor states in the email body itself overrides the model; use it and flag it in confidenceNotes as a sponsor override.",
  "LTC and LTV are almost always different numbers. Read both from the model explicitly (loan / total cost, loan / value); never assume they are equal or derive one from the other. If the model shows only one, leave the other blank and say so.",
  "LTV is total debt over purchase price; LTC is total debt over total capitalization. Compute each on its own from the model; they are almost never equal.",
  "IRR and equity multiple are deal-level: the total equity cash flow before any LP/GP split. If the model only shows split-level (LP or GP) returns, compute deal-level from the total equity line and flag it in confidenceNotes, noting the LP-level figures separately there in case an investor asks.",
  "Amortization comes from the model's cash flow sheet (the debt service rows); never assume it or carry it from another deal.",
  "Stabilized year: do not default to Year 3 for yield on cost or cash-on-cash. Read the occupancy and cash-on-cash rows by year and use the first year the asset is at or near stabilization (Year 4 or 5 on lease-up heavy deals); say which year you used in confidenceNotes.",
  "Model verification: when a model has several similarly labeled outputs (two different \"stabilized\" figures, two \"total cost\" cells), work out from the surrounding rows what each one divides or sums before trusting the label; when it stays ambiguous, leave the field blank and describe the ambiguity in confidenceNotes.",
  "Never invent numbers or facts. No placeholders: never write \"TBD\", \"N/A\", \"unknown\" or a guess; leave it blank and mention it in confidenceNotes.",
  "Enum-like fields (seller profile, lender type, deal sourcing, lender, closing time frame): fill them only when the source documents state them explicitly. Never infer the closest match; if you are tempted to, leave it blank and say so in confidenceNotes.",
  "Closest-match fields (how the deal was sourced, seller profile, lender type): when the documents state it in words that do not match an option, pick the closest option and say in confidenceNotes that it is an approximation, quoting the original wording. Exact-match fields (asset class, loan term, I/O and amortization, position in the capital stack): only when the documents clearly support that exact value; otherwise blank and flagged in confidenceNotes.",
  "Pad sale / outparcel rule: when the deal has scheduled pad or outparcel sales during the hold that pay down basis, yield on cost at stabilization must net those proceeds out of the denominator: (Stabilized NOI excluding pad income) / (Total Capitalization minus total pad sale net proceeds). Never divide by full total cap in that case; say in confidenceNotes that the pad sale rule was applied.",
  "Total capitalization comes from the Sources and Uses tab (total sources), not from adding debt and equity found on another tab, unless there is no Sources and Uses.",
  "Year 1 cap rate is always Year 1 proforma NOI over purchase price, never a later year, even when the deal stabilizes later. T12 cap rate is trailing or in-place NOI over purchase price.",
  "Stabilized cash-on-cash: levered cash flow after debt service in the stabilized year over total equity, from the model, never from sponsor materials.",
  "Interest rate: when the model shows more than one scenario (a fixed rate and a floating spread), write both as the model shows them; never pick one.",
  "Position in the capital stack: JV Equity unless the documents clearly say otherwise.",
  "executionType: an equity raise that is the majority of total equity is \"JV Equity\" (LP Equity is only a minority slice).",
  "Requested amount: the CRM sets it to 90% of total equity (total capitalization minus total debt) as a round number (whole millions from $5MM up, e.g. 12000000; half millions below). Report total equity and total debt accurately from the model; leave requestedAmount blank unless the sponsor names the raise in so many words, and even then the 90% rule decides.",
  "sponsorExperience is the sponsor bio: 3-4 sentences on founding background, focus/strategy, scale/track record. No return figures, no dashes.",
  "The sponsor bio runs in this order: when and by whom the firm was founded; its focus (asset classes, geography, deal type); its scale or track record. No return figures, no dollar figures, no specific states beyond general geography.",
  "summary is the business plan paragraph for the investor email: lead with location and market context, then anchor/key tenants, the value-add opportunity, notable physical attributes. 4-6 sentences, flowing prose, no dashes as punctuation. Never put in the summary what has its own field: exit strategy, return projections, dollar costs, financial metrics, seller profile, lender type, close timeline, year built, square footage, unit count.",
  "Style everywhere: no em dashes, en dashes or double hyphens as punctuation in any text you write. Plain sentences and commas.",
];

/** The schema depends on these; they are not editable on the page. */
export const FORMAT_RULES: string[] = [
  "Use an empty string for anything not stated.",
  "Dollar amounts are plain numbers in USD (\"$12.5MM\" -> 12500000, \"$3,200,000\" -> 3200000).",
  "Percentages are plain numbers (65% -> 65). LTV may appear as LTC or leverage.",
  "requestType: \"Equity\" for JV/LP/pref/co-GP equity raises, \"Debt\" for loans/bridge/construction/refi, \"Both\" if both.",
  "strategy: \"Development\" ONLY for ground-up or new construction (land or a site, a GC, a construction budget and loan, lease-up from zero, delivery dates). Everything on an existing, operating building is \"Acquisitions\": a purchase, a recapitalization or loan modification, a refinance, a value-add renovation, a lease-up of existing units, a capex program. A year built in the past, current occupancy, in-place rents or a T12 mean Acquisitions even if the plan spends heavily on renovations.",
  "unitMix, holdPeriod, loanTerm, amortization: pick the closest listed option; never write free text there. Unit counts and sizes belong in unitMix / units / squareFeet, never in the summary.",
  "expectedClose: the closing date or month if the email or model states one, written \"Month Year\" or \"Q# Year\" (\"November 2026\", \"Q1 2027\"); otherwise empty so we ask for it.",
  "assetClass must be one of the listed values; map synonyms (apartments -> Multifamily, BTR -> Build-For-Rent (SFR), hotel -> Hospitality, warehouse -> Industrial, shopping center -> Retail).",
  "state is the two-letter code. If only a metro is given, infer the state and note it in confidenceNotes.",
  "For each checklist item in details: quote or closely paraphrase what the sponsor said. For documents (proforma, rent roll/T12, trade-out report, capex budget, comps) answer \"Received\" only if the document is attached or explicitly provided; otherwise empty.",
];

/** What the code enforces after extraction, whatever the model returned. Shown on the page so nobody wonders why a value changed. */
export const BUILT_IN_RULES: string[] = [
  "Requested amount = 90% of total equity (total equity from the model, or total capitalization minus total debt), as a round number: whole millions from $5MM up, half millions between $1MM and $5MM, hundred thousands below. Debt requests are untouched.",
  "An equity raise that is half or more of total equity is JV Equity; an Equity request with no execution type is JV Equity.",
  "LTV = total debt / purchase price (not on developments) and LTC = total debt / total capitalization, each filled in only when the model left it blank.",
  "How the deal was sourced and the seller profile are HubSpot's dropdown lists, word for word; the extractor picks one or leaves the field blank.",
  "No em dashes, en dashes or double hyphens survive in any written text; no placeholders (TBD, N/A, unknown) either.",
  "The business plan paragraph loses any sentence that carries a fielded fact (returns, prices, square feet, units, close date) when it is saved and again when it is rendered.",
];

const clean = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

/** The rules as saved on the page; the seeded defaults until then. */
export async function loadUnderwritingRules(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  if (!row) return DEFAULT_UNDERWRITING_RULES;
  const lines = clean(row.value);
  return lines.length ? lines : DEFAULT_UNDERWRITING_RULES;
}

/** The page's textbox: what is saved, or the defaults one per line. */
export async function underwritingRulesText(): Promise<{ text: string; savedAt: Date | null }> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  return { text: row?.value?.trim() ? row.value : DEFAULT_UNDERWRITING_RULES.join("\n"), savedAt: row?.updatedAt ?? null };
}
