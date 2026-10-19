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
/** The sentences of a paragraph, a decimal never mistaken for a full stop (Oct 12, 2026: "a record low 2.5 percent" was cut at the "2."). */
export function planSentences(t: string): string[] {
  // a decimal, an abbreviation ("Onyx Partners Ltd. is") and a web address are not sentence ends (Oct 19, 2026: a sentence cut at "$2." left "0 billion of investment" standing on its own)
  const guarded = t
    .replace(/(\d)\.(\d)/g, "$1\u0000$2")
    .replace(/\b(Ltd|Inc|Co|Corp|LLC|LP|St|Ave|Rd|Blvd|Dr|Mr|Mrs|Ms|Jr|Sr|No|vs|approx|Sq|Ft|Mt|Ste|Bros)\.(?=\s)/g, "$1\u0000")
    .replace(/\b([A-Z])\.(?=\s?[A-Z](?:\.|[a-z]))/g, "$1\u0000") // initials: "J.P. Morgan", "U.S. markets"
    .replace(/\.(com|net|org|io|co)\b/gi, "\u0000$1");
  return (guarded.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [guarded]).map((x) => x.replace(/\u0000/g, ".").trim()).filter(Boolean);
}

/** The sentences the business plan filter would cut (figures, fields of their own): what a rewrite has to say in words instead. */
export function planProblems(s: string | null | undefined): string[] {
  const t = houseText(s);
  return t ? planSentences(t).filter((x) => BANNED_IN_PLAN.test(x)) : [];
}

const BANNED_IN_PLAN = /\$|\d(?:\.\d+)?\s?%|\b(irr|equity multiple|multiple of|cash[- ]on[- ]cash|cap rate|yield on cost|yoc|noi|ltv|ltc|loan|debt|lender|amortiz|interest rate|exit|disposition|refinanc|hold period|year hold|closing|close (?:in|by|date)|under contract|purchase price|total cap|capitalization|basis|cost|budget|seller|sourc(?:ed|ing)|off[- ]market|on[- ]market|built in|constructed in|vintage|square feet|square foot|sq\.? ?ft|\bsf\b|nrsf|rentable|units?\b|keys\b|beds\b|acres?\b|occupan)/i;

export function cleanBusinessPlan(s: string | null | undefined): string | null {
  const t = houseText(s);
  if (!t) return null;
  const banned = /\$|\d(?:\.\d+)?\s?%|\b(irr|equity multiple|multiple of|cash[- ]on[- ]cash|cap rate|yield on cost|yoc|noi|ltv|ltc|loan|debt|lender|amortiz|interest rate|exit|disposition|refinanc|hold period|year hold|closing|close (?:in|by|date)|under contract|purchase price|total cap|capitalization|basis|cost|budget|seller|sourc(?:ed|ing)|off[- ]market|on[- ]market|built in|constructed in|vintage|square feet|square foot|sq\.? ?ft|\bsf\b|nrsf|rentable|units?\b|keys\b|beds\b|acres?\b|occupan)/i;
  void banned;
  // a fragment left by an older cut ("0 billion of investment and was rezoned") is dropped rather than rendered (Oct 19, 2026)
  const FRAGMENT = /^\d[\d,.]*\s*(?:billion|million|thousand|percent|%|bps|units|square feet|sf|acres)\b/i;
  const kept = planSentences(t).filter((x) => !BANNED_IN_PLAN.test(x) && !FRAGMENT.test(x));
  const out = kept.slice(0, 6).join(" ").trim();
  return out || null;
}
/**
 * The sponsor bio is firm-level only (Jonathan, Oct 19, 2026): history, geography, focus and track record. A sentence
 * about the deal at hand, its approvals, grants, brokers or lender relationships is cut. Applied when a bio is written
 * and when the email renders, so older tickets comply too.
 */
// the deal's own status and go-betweens; a partner named on the project is firm context and stays
const DEAL_SPECIFIC_IN_BIO = /\b(for this (?:site|deal|property|transaction)|for the site|the subject (?:site|property)|zoning|rezon|entitlement|entitled|environmental approval|state grant|grant funding|grant award|tax credit award|broker|brokerage|capital markets team|JLL|CBRE|Cushman|Newmark|Marcus & Millichap|Eastdil|Walker & Dunlop|Berkadia|Colliers|term sheet|under contract|purchase agreement)\b/i;
/** A principal described by family relation ("Brendan Dale's father") is not a bio fact (Jonathan, Oct 19, 2026); name the person and role, or say "the firm's founder". */
export const FAMILY_RELATION_IN_BIO = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)?['’]s (?:father|mother|son|daughter|brother|sister|wife|husband|uncle|aunt|cousin|nephew|niece|grandfather|grandmother)\b/;
export function bioProblems(s: string | null | undefined): string[] {
  const t = houseText(s);
  return t ? planSentences(t).filter((x) => DEAL_SPECIFIC_IN_BIO.test(x) || FAMILY_RELATION_IN_BIO.test(x)) : [];
}
export function cleanSponsorBio(s: string | null | undefined): string | null {
  const t = houseText(s);
  if (!t) return null;
  const kept = planSentences(t).filter((x) => !DEAL_SPECIFIC_IN_BIO.test(x));
  const out = kept.join(" ").trim();
  return out || null;
}
