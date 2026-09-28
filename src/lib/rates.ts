/**
 * Debt pricing on a ticket (Jonathan, Sep 28, 2026): a loan is either fixed (one number, "6.75%") or priced as a
 * spread over an index (SOFR, Prime, or the 2, 5, 7 and 10 year treasuries). The indices are read daily (FRED) and the
 * indicative rate is index + spread, worked out wherever the rate is shown, so the deal email says
 * "300 bps over SOFR (6.90% today)". This module is pure (no database) because the deal form imports it; the daily
 * values arrive through `setIndexTable` (server) or on the deal object itself (`_indexRates`, for client previews).
 */

export const RATE_INDEXES = ["SOFR", "Prime", "2 Year Treasury", "5 Year Treasury", "7 Year Treasury", "10 Year Treasury"] as const;
export type RateIndex = (typeof RATE_INDEXES)[number];
/** "Assumption" in the Index dropdown: no index and no spread, the rate is typed as an assumption (Jonathan, Sep 28, 2026). */
export const ASSUMPTION = "Assumption";
export const RATE_INDEX_OPTIONS = [...RATE_INDEXES, ASSUMPTION] as const;
export type IndexTable = Record<string, { value: number; asOf: string }>;

let table: IndexTable = {};
/** The server fills this once per request from the IndexRate rows; a client bundle keeps it empty and reads the deal's own copy. */
export function setIndexTable(t: IndexTable) {
  table = t;
}
export function indexRatesNow(): IndexTable {
  return table;
}

type RateFields = { interestRate?: string | null; rateIndex?: string | null; rateSpreadBps?: number | null; _indexRates?: IndexTable };
const tableFor = (d: RateFields, t?: IndexTable) => t ?? d._indexRates ?? table;

/** Index + spread as a percentage, from the day's index; null when the index has no reading yet or the loan is fixed. */
export function indicativeRate(d: RateFields, t?: IndexTable): number | null {
  if (!d.rateIndex || d.rateIndex === ASSUMPTION || d.rateSpreadBps == null) return null;
  const idx = tableFor(d, t)[d.rateIndex];
  if (!idx) return null;
  return Math.round((idx.value + d.rateSpreadBps / 100) * 100) / 100;
}

/** The rate as a number: the indicative rate on a floating loan, the fixed rate otherwise. */
export function rateNumber(d: RateFields, t?: IndexTable): number | null {
  return d.rateIndex && d.rateIndex !== ASSUMPTION ? indicativeRate(d, t) : interestRateNumber(d.interestRate);
}

/** "300 bps over SOFR (6.90% today)" for a floating loan, "6.75%" for a fixed one, null when nothing is known. */
export function rateText(d: RateFields, t?: IndexTable): string | null {
  if (d.rateIndex && d.rateIndex !== ASSUMPTION && d.rateSpreadBps != null) {
    const now = indicativeRate(d, t);
    return `${d.rateSpreadBps} bps over ${d.rateIndex}${now != null ? ` (${now.toFixed(2)}% today)` : ""}`;
  }
  const fixed = interestRateNumber(d.interestRate);
  return fixed != null ? `${fixed}%` : cleanInterestRate(d.interestRate);
}

/** "SOFR + 300", "275 bps over the 10 year treasury", "prime + 1%": the index and the spread in basis points. */
export function parseSpread(raw: string | null | undefined): { rateIndex: RateIndex; rateSpreadBps: number } | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  let rateIndex: RateIndex | null = null;
  const t = text.match(/(\d{1,2})\s*-?\s*(?:yr|year)s?\.?\s*(?:t(?:reasury|reasuries)?|ust|swap)/i);
  if (t && ["2", "5", "7", "10"].includes(t[1])) rateIndex = `${t[1]} Year Treasury` as RateIndex;
  else if (/sofr|libor/i.test(text)) rateIndex = "SOFR";
  else if (/\bprime\b/i.test(text)) rateIndex = "Prime";
  if (!rateIndex) return null;
  const m = text.match(/(?:\+|over|plus)\s*(\d+(?:\.\d+)?)\s*(bps|bp|basis points|%)?/i) ?? text.match(/(\d+(?:\.\d+)?)\s*(bps|bp|basis points)\s*(?:over|above|on)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  const bps = unit === "%" || (!unit && n < 20) ? Math.round(n * 100) : Math.round(n);
  return bps > 0 && bps < 2000 ? { rateIndex, rateSpreadBps: bps } : null;
}

/** The fixed rate as a number for a numeric box ("6.75%" -> 6.75); null for a spread or nothing. */
export function interestRateNumber(raw: string | null | undefined): number | null {
  const m = (raw ?? "").trim().match(/^(\d{1,2}(?:\.\d+)?)\s*%?$/);
  return m ? Number(m[1]) : null;
}

const SPREAD = /(?:1-?\s*mo(?:nth)?\.?\s*)?(?:term\s*)?(?:SOFR|LIBOR|prime|treasur(?:y|ies)|\d+\s*-?\s*yr\.?\s*t(?:reasury)?)\s*(?:index[^+]*)?\+\s*\d+(?:\.\d+)?\s*(?:%|bps|basis points)?/i;

/** A fixed rate as "6.75%" from whatever was written; a spread alone is not a fixed rate (it belongs in the index and spread fields). */
export function cleanInterestRate(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const bare = text.match(/^(\d{1,2}(?:\.\d+)?)\s*%?$/);
  if (bare) return `${bare[1]}%`;
  const spread = text.match(SPREAD)?.[0] ?? null;
  const rest = spread ? text.replace(SPREAD, " ") : text;
  const pct = rest.match(/(?<![+\d])(\d{1,2}(?:\.\d+)?)\s*%/);
  return pct ? `${pct[1]}%` : null;
}
