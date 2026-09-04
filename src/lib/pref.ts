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
 */
import { assetProfile, perCountWord } from "@/lib/asset-profile";

export const PREF_TYPES = ["Preferred Equity", "Mezz Debt"];
export const isPref = (executionType: unknown) => typeof executionType === "string" && PREF_TYPES.includes(executionType);

type D = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[^0-9.-]/g, "")) || null : null);

export type PrefMetrics = {
  lastDollar: number | null;
  prefLtc: number | null; // percent
  prefLtv: number | null; // percent
  goingInYieldLD: number | null; // percent
  stabilizedYieldLD: number | null; // percent
  basisLD: number | null; // $ per unit/key/bed or per SF
  basisUnit: string; // "unit" | "key" | "bed" | "SF"
};

export function prefMetrics(d: D): PrefMetrics {
  const debt = n(d.totalDebt);
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
  const perCount = p.perCount && units;
  return {
    lastDollar,
    prefLtc: lastDollar && cap ? pct(lastDollar / cap) : null,
    prefLtv: lastDollar && price ? pct(lastDollar / price) : null,
    goingInYieldLD: lastDollar && t12Noi ? pct(t12Noi / lastDollar) : null,
    stabilizedYieldLD: lastDollar && stabNoi ? pct(stabNoi / lastDollar) : null,
    basisLD: lastDollar ? (perCount ? lastDollar / units! : sf ? lastDollar / sf : null) : null,
    basisUnit: perCount ? perCountWord(p.countLabel) : "SF",
  };
}
