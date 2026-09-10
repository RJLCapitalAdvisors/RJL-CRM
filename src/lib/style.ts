/**
 * House style for anything the CRM writes: no em dashes, en dashes or double hyphens as punctuation
 * (Aviel's rule, 2026-09-08). Hyphens inside words (value-add, 3-4) stay. Placeholders never survive.
 */

/** Dashes used as punctuation become a comma (mid-sentence) or a period (before a capital). */
export function stripDashes(s: string): string;
export function stripDashes(s: string | null | undefined): string | null;
export function stripDashes(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s
    .replace(/\s*(?:—|–|--)\s*(?=[A-Z][a-z])/g, ". ") // before a new sentence
    .replace(/\s*(?:—|–|--)\s*/g, ", ") // elsewhere
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*,/g, ".")
    .replace(/(^|\n)\s*,\s*/g, "$1")
    .replace(/,\s*(\.|$)/gm, "$1");
}

const PLACEHOLDER = /^\s*(tbd|tbc|n\/?a|unknown|not (?:provided|stated|available|given)|none|null|\?+|-+)\s*\.?\s*$/i;

/** Blank instead of "TBD" / "N/A" / "unknown": a missing number stays missing so the checklist asks for it. */
export function noPlaceholder(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return !t || PLACEHOLDER.test(t) ? null : t;
}

/** Both rules at once, for narrative fields. */
export function houseText(s: string | null | undefined): string | null {
  const t = noPlaceholder(s);
  return t ? stripDashes(t) : null;
}


/**
 * The business plan paragraph carries location and market, anchors, the value-add thesis and physical
 * attributes. Anything with its own field is cut sentence by sentence: dollar amounts, returns, cap rates,
 * yields, loan terms, exit, close timing, year built, square footage, unit counts, seller and sourcing. Applied
 * when the paragraph is written and again when it is rendered into an email, so older tickets comply too.
 */
export function cleanBusinessPlan(s: string | null | undefined): string | null {
  const t = houseText(s);
  if (!t) return null;
  const banned = /\$|\d(?:\.\d+)?\s?%|\b(irr|equity multiple|multiple of|cash[- ]on[- ]cash|cap rate|yield on cost|yoc|noi|ltv|ltc|loan|debt|lender|amortiz|interest rate|exit|disposition|refinanc|hold period|year hold|closing|close (?:in|by|date)|under contract|purchase price|total cap|capitalization|basis|cost|budget|seller|sourc(?:ed|ing)|off[- ]market|on[- ]market|built in|constructed in|vintage|square feet|square foot|sq\.? ?ft|\bsf\b|nrsf|rentable|units?\b|keys\b|beds\b|acres?\b|occupan)/i;
  const sentences = t.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [t];
  const kept = sentences.map((x) => x.trim()).filter((x) => x && !banned.test(x));
  const out = kept.slice(0, 6).join(" ").trim();
  return out || null;
}