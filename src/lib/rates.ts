/**
 * The interest rate on a ticket is one number with a % sign (Jonathan, Sep 24, 2026): "6.75%". Fixed or floating,
 * spreads ("SOFR + 285") and second loans belong in the debt terms text. Extractors and hands alike write sentences ("10.0% construction loan
 * rate; preferred equity return left open"); this keeps the rate and drops the rest.
 */
const SPREAD = /(?:1-?\s*mo(?:nth)?\.?\s*)?(?:term\s*)?(?:SOFR|LIBOR|prime|treasur(?:y|ies)|\d+\s*-?\s*yr\.?\s*t(?:reasury)?)\s*(?:index[^+]*)?\+\s*\d+(?:\.\d+)?\s*(?:%|bps|basis points)?/i;

/** The rate as a number for a numeric box ("6.75%" -> 6.75); null for a spread or nothing. */
export function interestRateNumber(raw: string | null | undefined): number | null {
  const m = (raw ?? "").trim().match(/^(\d{1,2}(?:\.\d+)?)\s*%?$/);
  return m ? Number(m[1]) : null;
}
export function cleanInterestRate(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // the ticket's box is numbers only (Jonathan, Sep 24, 2026): "6.75" or "6.75%" is 6.75%
  const bare = text.match(/^(\d{1,2}(?:\.\d+)?)\s*%?$/);
  if (bare) return `${bare[1]}%`;
  const spread = text.match(SPREAD)?.[0]?.replace(/\s+/g, " ").replace(/\s*\+\s*/, " + ").trim() ?? null;
  // percentages that are not the spread itself (the "+ 2.85%" part of a spread is not the rate)
  const rest = spread ? text.replace(SPREAD, " ") : text;
  const pct = rest.match(/(?<![+\d])(\d{1,2}(?:\.\d+)?)\s*%/);
  if (pct) {
    const value = `${pct[1]}%`;
    const after = rest.slice((pct.index ?? 0) + pct[0].length, (pct.index ?? 0) + pct[0].length + 24).toLowerCase();
    const before = rest.slice(Math.max(0, (pct.index ?? 0) - 12), pct.index ?? 0).toLowerCase();
    void after;
    void before;
    return value; // numbers only: fixed or floating belongs in the debt terms text
  }
  void spread; // a spread alone is not a rate the numeric box can hold: it stays in the debt terms text
  return null;
}
