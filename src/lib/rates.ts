/**
 * The interest rate on a ticket is one simple rate (Jonathan, Sep 24, 2026): "6.75% fixed", "6.65% floating",
 * "SOFR + 285" when no all-in rate is given. Extractors and hands alike write sentences ("10.0% construction loan
 * rate; preferred equity return left open"); this keeps the rate and drops the rest.
 */
const SPREAD = /(?:1-?\s*mo(?:nth)?\.?\s*)?(?:term\s*)?(?:SOFR|LIBOR|prime|treasur(?:y|ies)|\d+\s*-?\s*yr\.?\s*t(?:reasury)?)\s*(?:index[^+]*)?\+\s*\d+(?:\.\d+)?\s*(?:%|bps|basis points)?/i;

export function cleanInterestRate(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const spread = text.match(SPREAD)?.[0]?.replace(/\s+/g, " ").replace(/\s*\+\s*/, " + ").trim() ?? null;
  // percentages that are not the spread itself (the "+ 2.85%" part of a spread is not the rate)
  const rest = spread ? text.replace(SPREAD, " ") : text;
  const pct = rest.match(/(?<![+\d])(\d{1,2}(?:\.\d+)?)\s*%/);
  if (pct) {
    const value = `${pct[1]}%`;
    const after = rest.slice((pct.index ?? 0) + pct[0].length, (pct.index ?? 0) + pct[0].length + 24).toLowerCase();
    const before = rest.slice(Math.max(0, (pct.index ?? 0) - 12), pct.index ?? 0).toLowerCase();
    const kind = /\bfixed\b/.test(after) || /\bfixed\b/.test(before) ? " fixed" : /\bfloat/.test(after) || /\bfloat/.test(before) ? " floating" : "";
    return `${value}${kind}`;
  }
  if (spread) return spread.replace(/\s*(bps|basis points)$/i, "").replace(/(\d)\s*%$/, "$1%");
  return text.length <= 24 ? text : null;
}
