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
  "Asset class: pick the closest matching option based on the property type described in the source documents. If the property type is genuinely ambiguous or mixed, flag it in confidenceNotes rather than guessing.",
  "Acquisition or development: determine from context. Buying an existing operating asset is acquisition; ground-up construction or a major redevelopment is development.",
  "Expected close: format as a plain month and year (e.g., \"November 2026\") or a quarter and year (e.g., \"Q1 2027\"), pulled from whatever the sponsor states as target closing.",
  "City, State: pull both from the source documents whenever available, separate from the full street address field. If the deal only has a city/state and no exact address, still populate city and state, don't leave the whole location blank just because a full address isn't given.",
  "Occupancy and year built: pull from the model or OM when the deal is an acquisition of an operating asset. For ground-up development, these often don't exist yet; leave blank rather than writing a projected or placeholder value, and don't substitute a construction completion date for year built.",
  "Address: extract the property address from anywhere it appears in the source materials, including the email body, signature block, subject line, or attachments, even if the subject line is otherwise stale. Never leave the address field blank if an address exists anywhere in the source documents. Only leave it blank, with a note in confidenceNotes, if no address appears anywhere at all.",
  "Acreage: report as a single, clear total figure (e.g., \"38.6 acres\"). If the source documents describe multiple parcels (for example, a 29-acre parcel for the building plus a separate 10-acre adjacent parcel), do not present the two figures side by side without reconciling them. Either compute and state one correct combined total, or if the parcels are genuinely separate and not meant to be added together, state clearly which acreage belongs to which parcel (main site vs. adjacent site) in confidenceNotes rather than presenting two disconnected numbers with no explanation.",
  "Owner: this is the internal RJL team member who forwarded the sponsor email to deals@rjlcapadvisors.com. It is never the sponsor, never a name in the sponsor's email signature, and never guessed from deal context. If it's unclear who forwarded the email, leave this blank and flag it in confidenceNotes rather than assuming.",
  "Data source priority: every number is calculated from the Excel model directly, never from the OM, deck or sponsor talking points. One exception: a figure the sponsor states in the email body itself overrides the model; use it and flag it in confidenceNotes as a sponsor override.",
  "LTC and LTV are almost always different numbers. Read both from the model explicitly (loan / total cost, loan / value); never assume they are equal or derive one from the other. If the model shows only one, leave the other blank and say so.",
  "LTV is total debt over purchase price; LTC is total debt over total capitalization. Compute each on its own from the model; they are almost never equal.",
  "LTV and T12 cap rate rely on actual in-place operating history and debt sized to value. For ground-up development, or acquisitions still in lease-up with no meaningful trailing operating history, leave these two fields blank and note in confidenceNotes that the deal doesn't have the operating history needed to calculate them, rather than computing off a near-zero or non-existent NOI.",
  "IRR and equity multiple are deal-level: the total equity cash flow before any LP/GP split. If the model only shows split-level (LP or GP) returns, compute deal-level from the total equity line and flag it in confidenceNotes, noting the LP-level figures separately there in case an investor asks.",
  "Amortization comes from the model's cash flow sheet (the debt service rows); never assume it or carry it from another deal.",
  "Stabilized year: do not default to Year 3 for yield on cost or cash-on-cash. Read the occupancy and cash-on-cash rows by year and use the first year the asset is at or near stabilization (Year 4 or 5 on lease-up heavy deals); say which year you used in confidenceNotes.",
  "Model verification: when a model has several similarly labeled outputs (two different \"stabilized\" figures, two \"total cost\" cells), work out from the surrounding rows what each one divides or sums before trusting the label; when it stays ambiguous, leave the field blank and describe the ambiguity in confidenceNotes.",
  "Never invent numbers or facts. No placeholders: never write \"TBD\", \"N/A\", \"unknown\" or a guess; leave it blank and mention it in confidenceNotes. Never let an unrelated figure (a budget number, a stray total, a capex line item) land in the wrong field. Every field should contain only what its label describes; if a number cannot be confidently placed in its correct field, leave that field blank and flag it in confidenceNotes rather than dropping it into a nearby field.",
  "Enum-like fields (seller profile, lender type, deal sourcing, lender, closing time frame): fill them only when the source documents state them explicitly. Never infer the closest match; if you are tempted to, leave it blank and say so in confidenceNotes.",
  "Closest-match fields (how the deal was sourced, seller profile, lender type): when the documents state it in words that do not match an option, pick the closest option and say in confidenceNotes that it is an approximation, quoting the original wording. Exact-match fields (asset class, loan term, I/O and amortization, position in the capital stack): only when the documents clearly support that exact value; otherwise blank and flagged in confidenceNotes.",
  "Units, unit mix, and average unit size only apply to Multifamily, Build-For-Rent, Student Housing, or Senior Housing deals. Leave these blank for industrial, retail, office, or any other non-residential asset class. Purchase price per unit and total capitalization per unit follow the same scope, blank for non-residential deals.",
  "Purchase price per SF and total capitalization per SF apply to every deal type: purchase price per SF is purchase price over square feet; total capitalization per SF is total capitalization over square feet. These are entered as the exact calculated figure, not rounded (see rounding note below, which applies only to requestedAmount).",
  "Pad sale / outparcel rule: when the deal has scheduled pad or outparcel sales during the hold that pay down basis, yield on cost at stabilization must net those proceeds out of the denominator: (Stabilized NOI excluding pad income) / (Total Capitalization minus total pad sale net proceeds). Never divide by full total cap in that case; say in confidenceNotes that the pad sale rule was applied.",
  "Total capitalization comes from the Sources and Uses tab (total sources), not from adding debt and equity found on another tab, unless there is no Sources and Uses. Entered as the exact figure from the model, not rounded.",
  "Total equity is total capitalization minus total debt. Compute this explicitly from the model's Sources and Uses if it isn't already an auto-calculated field in the CRM. Entered as the exact figure, not rounded.",
  "Year 1 cap rate is always Year 1 proforma NOI over purchase price, never a later year, even when the deal stabilizes later. T12 cap rate is trailing or in-place NOI over purchase price.",
  "Stabilized cash-on-cash: levered cash flow after debt service in the stabilized year over total equity, from the model, never from sponsor materials.",
  "Interest rate: when the model shows more than one scenario (a fixed rate and a floating spread), write both as the model shows them; never pick one.",
  "Position in the capital stack: JV Equity unless the documents clearly say otherwise.",
  "executionType: an equity raise that is the majority of total equity is \"JV Equity\" (LP Equity is only a minority slice).",
  "Hold period: pull from the model's underwriting assumptions, or from the sponsor's stated business plan if the model doesn't state it directly.",
  "Requested amount (critical, this has produced bad output before): requestedAmount is ALWAYS calculated as 90% of total equity (total capitalization minus total debt), rounded per the convention below. This calculation runs every time, regardless of what number the sponsor states as their ask in the email. Do not read the sponsor's stated raise amount and use it directly, and do not treat the sponsor naming a number as a reason to skip the 90% calculation. The sponsor's stated ask is not a source of truth for this field under any circumstance.",
  "Rounding convention for requestedAmount only: whole millions when the result is $5MM or above (e.g., $11,844,000 rounds to $12,000,000); half millions when the result is below $5MM. This rounding rule applies exclusively to requestedAmount. Every other dollar field in this record, purchase price, total capitalization, total debt, total equity, and all per-SF or per-unit dollar figures, is entered as the exact number calculated or pulled from the model, never rounded to the nearest $500k or nearest million.",
  "Sanity check before finalizing: requestedAmount must never equal total equity. If the two numbers come out identical, the 90% calculation did not run, this is a bug, recompute it.",
  "Before writing sponsorExperience or summary, search Fireflies by sponsor name, asset name, and deal contact name (as separate searches). If a relevant call transcript exists, use it as a source alongside the email and deck, this often surfaces real detail (market color, specific sponsor track record, tenant context) that isn't in the email or deck alone. Write both narrative fields once, incorporating anything useful found, rather than writing them first and revising after.",
  "sponsorExperience (sponsor bio): 3 to 4 sentences, in this exact order: (1) when and by whom the firm was founded, and where it's based, (2) its focus or strategy, meaning what asset classes, deal types, or geography it specializes in, (3) its scale or track record, meaning AUM, number of deals closed, total square footage or units developed or acquired, or years active, whichever of these the source documents actually state. If the documents only support 2 of the 3 elements, write 3 sentences and skip the missing one rather than inventing or padding with vague filler like \"a strong reputation in the industry.\" Geography here means general region (e.g., \"based in the Midwest,\" \"active nationally,\" \"focused on the Southeast\"), not a list of every state or market they've done a deal in. Never include return figures, dollar figures, specific transaction details, or anything about this particular deal, including how the sponsor structures investor relationships or references to prior correspondence. No dashes.",
  "summary (business plan paragraph): 4 to 6 sentences, written as connected, flowing prose, never as a disguised list (avoid patterns like \"The property features X. It also has Y. Additionally, Z.\"). Structure: (1) location and market context, meaning submarket, proximity to infrastructure or demand drivers, (2) anchor or key tenants, only if the source documents name actual tenants or a specific tenant demand driver; if this is a spec development with no signed tenants, skip this element rather than inventing a tenant, (3) the value-add or development thesis, meaning what's being built, renovated, or repositioned, and why, (4) physical attributes that are actually stated in the documents (construction type, clear height, unit or building specs, site flexibility), not invented or assumed details. If skipping element 2 makes the paragraph run short of 4 sentences, expand on element 3 or 4 with more specific stated detail rather than padding with generic language. Never include exit strategy, return projections, dollar costs, financial metrics, seller profile, lender type, close timeline, year built, square footage, or unit count, these belong in their own fields. If this field ever comes back as a single number, a fragment, or blank when source material exists, that's a failure state, recompute rather than return it.",
  "Formatting: dollar values with $ and commas (e.g., $27,500,000), applied to every dollar field regardless of whether it's rounded (requestedAmount) or exact (every other dollar field). Percentages with % symbol, two decimal places, applied uniformly to every percentage field in the record (e.g., 6.75%, not 6.7% or 6.750%). Equity multiple with lowercase x suffix (e.g., 2.06x). Square footage and any manually entered per-unit or per-SF dollar figures always with commas. Never write a raw unformatted number into any field.",
  "Style everywhere: no em dashes, en dashes or double hyphens as punctuation in any text you write. Plain sentences and commas.",
  "Year built, occupancy, site acreage and the building's physical facts usually sit in the model's property or building information block (often on a Summary, Assumptions or Inputs sheet, labeled Building Information, Property Summary or similar), not in the cash flow rows. Read that block before the cash flows; year built is stated there even when the OM leaves it out.",
  "Expected close comes only from a stated closing date or target close: the sponsor's email, a PSA or LOI date, a critical dates schedule, or a line that says when the deal closes. A business plan or value creation timeline in an OM (\"acquire in November 2026\", \"sell in year five\") is an illustration of the plan, not a closing date; never take the close from it. When no closing date is stated anywhere, leave expectedClose blank and say so in confidenceNotes so the team asks.",
];

/** The schema depends on these; they are not editable on the page. */
export const FORMAT_RULES: string[] = [
  "Use an empty string for anything not stated.",
  "Values are returned as plain numbers. The CRM adds $, commas, % (two decimals) and the x on multiples when it shows or emails them, so a house rule about display formatting is satisfied by the CRM; never put $, commas or % into a number field.",
  "Fireflies call transcripts are pulled in by the CRM in a separate step after extraction (it searches by sponsor, asset and contact name); write the bio and business plan from the documents in front of you.",
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
  "Requested amount = 90% of total equity (total equity from the model, or total capitalization minus total debt), as a round number: whole millions from $5MM up, half millions below. It never equals total equity. Debt requests are untouched.",
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
