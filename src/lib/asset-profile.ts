/**
 * What we measure per asset class. Drives which fields the deal form shows and
 * which per-unit metrics get calculated.
 *   Multifamily / BFR / Senior housing -> per unit and per foot
 *   Retail / Industrial / Office etc.   -> per foot only
 *   Hospitality                         -> per key
 *   Student housing                     -> per bed
 *   Land                                -> per acre
 */
export type AssetProfile = {
  countLabel: string | null; // "Units" | "Keys" | "Beds" | null
  perCount: boolean; // show price / cap per unit-key-bed
  perFoot: boolean; // show price / cap per SF
  perAcre: boolean;
  showOccupancy: boolean;
  showUnitMix: boolean;
  showYearBuilt: boolean;
};

const BASE: AssetProfile = { countLabel: null, perCount: false, perFoot: true, perAcre: false, showOccupancy: true, showUnitMix: false, showYearBuilt: true };

const PROFILES: Record<string, Partial<AssetProfile>> = {
  Multifamily: { countLabel: "Units", perCount: true, perFoot: true, showUnitMix: true },
  "Build-For-Rent (SFR)": { countLabel: "Units", perCount: true, perFoot: true, showUnitMix: true },
  Condo: { countLabel: "Units", perCount: true, perFoot: true, showUnitMix: true, showOccupancy: false }, // for-sale units: sellout, not NOI (Jonathan, Sep 23, 2026)
  "Senior Housing": { countLabel: "Units", perCount: true, perFoot: true, showUnitMix: true },
  "Student Housing": { countLabel: "Beds", perCount: true, perFoot: false, showUnitMix: true },
  Hospitality: { countLabel: "Keys", perCount: true, perFoot: false },
  Retail: {},
  Industrial: {},
  Office: {},
  "Medical Office": {},
  "Office/Flex": {},
  "Mixed Use": { countLabel: "Units", perCount: true, perFoot: true },
  "Self Storage": { countLabel: "Units", perCount: true, perFoot: true },
  "Build To Suit": {},
  Land: { perFoot: false, perAcre: true, showOccupancy: false, showYearBuilt: false },
  "Notes (Distressed Debt)": { perFoot: false, showOccupancy: false, showYearBuilt: false },
  "Asset Class Agnostic": {},
};

export function assetProfile(assetClass: string | null | undefined): AssetProfile {
  return { ...BASE, ...(assetClass ? PROFILES[assetClass] ?? {} : {}) };
}

/** Singular unit word for "per ___" labels. */
export function perCountWord(countLabel: string | null) {
  return countLabel === "Keys" ? "key" : countLabel === "Beds" ? "bed" : "unit";
}

export function ratio(a: number | null | undefined, b: number | null | undefined) {
  return a && b && b > 0 ? a / b : null;
}
