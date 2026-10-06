/**
 * Preferred equity / mezz metrics. These investors sit between the senior debt and the common
 * equity, so what matters is where their last dollar lands in the stack and how well the
 * property's income covers it, not the sponsor's IRR or multiple.
 *
 *   Last dollar exposure   = senior debt + requested pref/mezz amount
 *   Pref LTC               = last dollar / total capitalization
 *   Pref LTV               = last dollar / purchase price
 *   Going-in yield on LD   = T12 NOI / last dollar          (T12 NOI = T12 cap rate x purchase price)
 *   Stabilized yield on LD = stabilized NOI / last dollar   (stabilized NOI = yield on cost x total capitalization)
 *   Stabilized basis on LD = last dollar per unit / key / bed, or per SF
 *
 * Land (Jonathan, Oct 6, 2026): no income and no building, so nothing per unit, per foot or on NOI. The pref is
 * measured against the land: Pref LTV on the current (unentitled) value, Pref LTV on the entitled value, and the
 * entitled value's cover of the last dollar.
 */
import { assetProfile, perCountWord } from "@/lib/asset-profile";

export const PREF_TYPES = ["Preferred Equity", "Mezz Debt"];
export const isPref = (executionType: unknown) => typeof executionType === "string" && PREF_TYPES.includes(executionType);
/** A condo development sells its units: there is no NOI, so no yield on cost, no cash on cash, no yield on the last dollar; the basis on the last pref dollar is quoted per foot (Jonathan, Sep 23, 2026). */
export const isCondo = (assetClass: unknown) => assetClass === "Condo";
/** Land being entitled (Jonathan, Oct 6, 2026): value today against value once entitled; nothing per unit, per foot or on NOI. */
export const isLand = (assetClass: unknown) => assetClass === "Land";

type D = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[^0-9.-]/g, "")) || null : null);

export type PrefMetrics = {
  lastDollar: number | null;
  prefLtc: number | null; // percent
  prefLtv: number | null; // percent: last dollar over purchase price, over the gross sellout on a condo (Jonathan, Sep 24, 2026), or over the current land value on land
  prefLtvBase: "price" | "sellout" | "land";
  prefLtvEntitled: number | null; // percent: last dollar over the entitled land value (land only)
  entitledCover: number | null; // x: entitled land value over the last dollar (land only)
  goingInYieldLD: number | null; // percent
  stabilizedYieldLD: number | null; // percent
  basisLD: number | null; // $ per unit/key/bed or per SF
  basisUnit: string; // "unit" | "key" | "bed" | "SF"
  basisPerUnitLD: number | null; // when the basis reads per SF (a condo): last dollar over the unit count as well (Jonathan, Sep 25, 2026)
};

export function prefMetrics(d: D): PrefMetrics {
  const debt = d.unlevered === true ? 0 : n(d.totalDebt);
  const ask = n(d.requestedAmount);
  const cap = n(d.totalCapitalization);
  const price = n(d.purchasePrice);
  const t12 = n(d.capRateT12);
  const yoc = n(d.yieldOnCost);
  const units = n(d.units);
  const sf = n(d.squareFeet);
  const p = assetProfile(typeof d.assetClass === "string" ? d.assetClass : null);
  const lastDollar = debt != null && ask != null ? debt + ask : null;
  const pct = (x: number | null) => (x == null ? null : Math.round(x * 10000) / 100);
  const t12Noi = t12 != null && price ? (t12 / 100) * price : null;
  const stabNoi = yoc != null && cap ? (yoc / 100) * cap : null;
  const condo = isCondo(d.assetClass);
  const land = isLand(d.assetClass);
  const sellout = n(d.projectedSellout);
  const landNow = n(d.landValueCurrent) ?? price;
  const landEntitled = n(d.landValueEntitled);
  const perCount = p.perCount && units && !condo; // a condo's basis reads per foot
  return {
    lastDollar,
    prefLtc: lastDollar && cap ? pct(lastDollar / cap) : null,
    prefLtv: land ? (lastDollar && landNow ? pct(lastDollar / landNow) : null) : condo ? (lastDollar && sellout ? pct(lastDollar / sellout) : null) : lastDollar && price ? pct(lastDollar / price) : null,
    prefLtvBase: land ? "land" : condo ? "sellout" : "price",
    prefLtvEntitled: land && lastDollar && landEntitled ? pct(lastDollar / landEntitled) : null,
    entitledCover: land && lastDollar && landEntitled ? Math.round((landEntitled / lastDollar) * 100) / 100 : null,
    goingInYieldLD: lastDollar && t12Noi && !condo && !land && d.strategy !== "Development" ? pct(t12Noi / lastDollar) : null,
    stabilizedYieldLD: lastDollar && stabNoi && !condo && !land ? pct(stabNoi / lastDollar) : null,
    basisLD: lastDollar && !land ? (perCount ? lastDollar / units! : sf ? lastDollar / sf : null) : null,
    basisUnit: perCount ? perCountWord(p.countLabel) : "SF",
    basisPerUnitLD: lastDollar && !land && !perCount && units ? lastDollar / units : null,
  };
}
