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
