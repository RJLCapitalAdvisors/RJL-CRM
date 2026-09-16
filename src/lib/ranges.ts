import { CHECK_SIZES, HOLD_PERIODS, VINTAGES } from "@/lib/taxonomy";

/**
 * Range fields on investor criteria. Jonathan sets check size and hold period as a min/max in $1MM and
 * 1-year steps and vintage in 5-year steps; the legacy bucket lists (CHECK_SIZES, HOLD_PERIODS,
 * VINTAGES) are derived from the range so Investor search, matching and HubSpot data keep working.
 */
export type Stop = { value: number; label: string };

// ---- check size: $1MM … $100MM+ (100 means "$100MM and up")
export const CHECK_MAX = 100;
export const CHECK_STOPS: Stop[] = Array.from({ length: CHECK_MAX }, (_, i) => ({ value: i + 1, label: i + 1 >= CHECK_MAX ? "$100MM+" : `$${i + 1}MM` }));
const CHECK_BUCKETS: Record<string, [number, number]> = { "$1-2MM": [1, 2], "$3-5MM": [3, 5], "$5-8MM": [5, 8], "$8-10MM": [8, 10], "$10-15MM": [10, 15], "$15-20MM": [15, 20], "$20-30MM": [20, 30], "$30-50MM": [30, 50], "$50-100MM": [50, 100], "$100MM+": [100, Infinity] };

// ---- hold period: 1 … 10+ years
export const HOLD_MAX = 10;
export const HOLD_STOPS: Stop[] = Array.from({ length: HOLD_MAX }, (_, i) => ({ value: i + 1, label: i + 1 >= HOLD_MAX ? "10+ years" : `${i + 1} year${i === 0 ? "" : "s"}` }));
const HOLD_BUCKETS: Record<string, [number, number]> = { "1-3 years": [1, 3], "3-5 years": [3, 5], "5-7 years": [5, 7], "7-10 years": [7, 10], "10+ years": [10, Infinity] };

// ---- vintage: Older than 1960, 1960, 1965 … 2025, New construction
export const VINTAGE_OLDER = 1950; // sentinel for "older than 1960"
export const VINTAGE_NEW = 9999; // sentinel for new construction
export const VINTAGE_STOPS: Stop[] = [{ value: VINTAGE_OLDER, label: "Older than 1960" }, ...Array.from({ length: (2025 - 1960) / 5 + 1 }, (_, i) => ({ value: 1960 + i * 5, label: String(1960 + i * 5) })), { value: VINTAGE_NEW, label: "New construction" }];
const VINTAGE_BUCKETS: Record<string, [number, number]> = { "Older than 1960": [0, 1959], "1960s": [1960, 1969], "1970s": [1970, 1979], "1980s": [1980, 1989], "1990s": [1990, 1999], "2000s": [2000, 2009], "2010s": [2010, 2019], "2020s": [2020, 2029], "New Construction": [VINTAGE_NEW, VINTAGE_NEW] };

const overlaps = (lo: number, hi: number, min: number, max: number) => lo <= max && hi >= min;

/** Buckets covered by a range; open-ended top stop counts as infinity. */
export function checkBucketsFor(min: number, max: number): string[] {
  const hi = max >= CHECK_MAX ? Infinity : max;
  return CHECK_SIZES.filter((b) => overlaps(CHECK_BUCKETS[b][0], CHECK_BUCKETS[b][1], min, hi));
}
export function holdBucketsFor(min: number, max: number): string[] {
  const hi = max >= HOLD_MAX ? Infinity : max;
  return HOLD_PERIODS.filter((b) => overlaps(HOLD_BUCKETS[b][0], HOLD_BUCKETS[b][1], min, hi));
}
export function vintageBucketsFor(min: number, max: number): string[] {
  const lo = min <= VINTAGE_OLDER ? 0 : min;
  const hi = max >= VINTAGE_NEW ? VINTAGE_NEW : max + 4; // a 5-year stop covers itself and the next four years
  return VINTAGES.filter((b) => overlaps(VINTAGE_BUCKETS[b][0], VINTAGE_BUCKETS[b][1], lo, hi));
}

/** Range implied by a legacy bucket list (for migrating HubSpot data and approved proposals). */
export function checkRangeFrom(buckets: string[]): [number, number] | null {
  const bs = buckets.map((b) => CHECK_BUCKETS[b]).filter(Boolean);
  if (!bs.length) return null;
  return [Math.min(...bs.map((b) => b[0])), Math.min(CHECK_MAX, Math.max(...bs.map((b) => b[1])))];
}
export function holdRangeFrom(buckets: string[]): [number, number] | null {
  const bs = buckets.map((b) => HOLD_BUCKETS[b]).filter(Boolean);
  if (!bs.length) return null;
  return [Math.min(...bs.map((b) => b[0])), Math.min(HOLD_MAX, Math.max(...bs.map((b) => b[1])))];
}
export function vintageRangeFrom(buckets: string[]): [number, number] | null {
  const bs = buckets.map((b) => VINTAGE_BUCKETS[b]).filter(Boolean);
  if (!bs.length) return null;
  const lo = Math.min(...bs.map((b) => b[0]));
  const hi = Math.max(...bs.map((b) => b[1]));
  const min = lo < 1960 ? VINTAGE_OLDER : lo;
  const max = hi >= VINTAGE_NEW ? VINTAGE_NEW : Math.min(2025, Math.floor((hi - 4) / 5) * 5);
  return [min, Math.max(min, max)];
}

export const labelFor = (stops: Stop[], v: number) => stops.find((s) => s.value === v)?.label ?? String(v);
export function rangeLabel(stops: Stop[], min: number | null | undefined, max: number | null | undefined, any = "Any") {
  if (min == null || max == null) return any;
  return min === max ? labelFor(stops, min) : `${labelFor(stops, min)} to ${labelFor(stops, max)}`;
}

/**
 * The check size as one precise range ("$8MM to $25MM", "$100MM+"), from the slider values, or from the legacy
 * buckets when a record was never edited on the slider. Jonathan (Sep 16): never the old bucket list.
 */
export function checkLabel(c: { checkMinMM?: number | null; checkMaxMM?: number | null; checkSizes?: string | string[] | null } | null | undefined, none = "—"): string {
  if (!c) return none;
  let min = c.checkMinMM ?? null, max = c.checkMaxMM ?? null;
  if (min == null || max == null) {
    const list = Array.isArray(c.checkSizes) ? c.checkSizes : c.checkSizes ? (JSON.parse(c.checkSizes) as string[]) : [];
    const r = checkRangeFrom(list);
    if (!r) return none;
    [min, max] = r;
  }
  return rangeLabel(CHECK_STOPS, min, max, none);
}
