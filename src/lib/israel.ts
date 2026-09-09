/**
 * RJL Israel: apartments (the "deals" of that business), the people and firms around them, and the words
 * used for both. Kept separate from the RJL Capital Advisors data; where a choice is unclear, the RJL CA
 * conventions apply.
 */

export const IL_ROLES = ["Buyer", "Seller", "Sales agent"] as const;
export const IL_COMPANY_KINDS = ["Developer", "Agency", "Law firm", "Mortgage", "Other"] as const;
export const IL_DIRECTIONS = ["North", "South", "East", "West"] as const;
export const IL_PARKING = ["None", "1", "2 - back to back", "2 side by side", "3"] as const;
export const IL_MACHSAN_LOCATIONS = ["Attached to apartment", "In basement"] as const;
export const IL_CITIES = ["Jerusalem", "Tel Aviv", "Herzliya", "Ra'anana", "Netanya", "Modi'in", "Beit Shemesh", "Ramat Gan", "Givatayim", "Haifa", "Ashdod", "Ashkelon", "Petah Tikva", "Rehovot", "Efrat", "Ma'ale Adumim"] as const;

export const SQFT_PER_SQM = 10.7639;
export const CM_PER_FOOT = 30.48;

export const nis = (n: number | null | undefined) => (n == null ? "" : `₪${Math.round(n).toLocaleString("en-US")}`);
export const usdFmt = (n: number | null | undefined) => (n == null ? "" : `$${Math.round(n).toLocaleString("en-US")}`);
export const nisShort = (n: number | null | undefined) => (n == null ? "" : n >= 1_000_000 ? `₪${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.?0+$/, "")}M` : `₪${Math.round(n / 1000)}K`);
export const sqm = (n: number | null | undefined) => (n == null ? "" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} m²`);
export const sqft = (m2: number | null | undefined) => (m2 == null ? "" : `${Math.round(m2 * SQFT_PER_SQM).toLocaleString("en-US")} sq ft`);
export const feet = (cm: number | null | undefined) => {
  if (cm == null) return "";
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`;
};

/** Price per meter the RJL Israel way: asking price over internal m² plus one third of the mirpeset m². */
export const pricePerMeter = (price: number | null | undefined, internal: number | null | undefined, mirpeset: number | null | undefined) => {
  if (!price || !internal) return null;
  const area = internal + (mirpeset ?? 0) / 3;
  return area > 0 ? Math.round(price / area) : null;
};
export const PRICE_PER_METER_NOTE = "asking price ÷ (internal m² + ⅓ of the mirpeset m²)";

export const parseJsonList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export type IlApartmentLike = { name: string; city: string | null; neighborhood: string | null; street: string | null; rooms: number | null; internalSqm: number | null; mirpesetSqm: number | null; priceNis: number | null; floor: number | null };

/** One line that says what the apartment is: "4 rooms · 108 m² + 14 m² mirpeset · floor 3 · Rehavia, Jerusalem". */
export function apartmentLine(a: IlApartmentLike) {
  return [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? `${sqm(a.internalSqm)}${a.mirpesetSqm ? ` + ${sqm(a.mirpesetSqm)} mirpeset` : ""}` : null, a.floor != null ? `floor ${a.floor}` : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ");
}

export const ilFullName = (c: { firstName: string | null; lastName: string | null; email: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(no name)";
