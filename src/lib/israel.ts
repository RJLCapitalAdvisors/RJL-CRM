/**
 * RJL Israel: apartments (the "deals" of that business), the people and firms around them, and the words
 * used for both. Kept separate from the RJL Capital Advisors data; where a choice is unclear, the RJL CA
 * conventions apply.
 */

export const IL_STAGES = ["Apartment Received", "Reviewed", "Sent to Buyers", "Viewing Scheduled", "Offer Made", "Under Contract", "Closed", "Lost"] as const;
export type IlStage = (typeof IL_STAGES)[number];
export const IL_ACTIVE_STAGES: IlStage[] = ["Apartment Received", "Reviewed", "Sent to Buyers", "Viewing Scheduled", "Offer Made", "Under Contract"];

export const IL_APARTMENT_TYPES = ["New build", "Pre-sale (on paper)", "Resale", "Penthouse", "Garden apartment", "Duplex", "Mini penthouse", "Studio"] as const;
export const IL_DIRECTIONS = ["North", "South", "East", "West"] as const;
export const IL_CONDITIONS = ["New", "Renovated", "Good", "Needs renovation", "Shell"] as const;
export const IL_ROLES = ["Buyer", "Seller", "Agent", "Developer", "Lawyer", "Mortgage advisor", "Investor", "Other"] as const;
export const IL_COMPANY_KINDS = ["Developer", "Agency", "Law firm", "Mortgage", "Buyer entity", "Investor", "Other"] as const;
export const IL_CITIES = ["Jerusalem", "Tel Aviv", "Herzliya", "Ra'anana", "Netanya", "Modi'in", "Beit Shemesh", "Ramat Gan", "Givatayim", "Haifa", "Ashdod", "Ashkelon", "Petah Tikva", "Rehovot", "Efrat", "Ma'ale Adumim", "Other"] as const;

export const stageToneIl: Record<string, string> = {
  "Apartment Received": "bg-sky/30 text-ink",
  Reviewed: "bg-sky/50 text-ink",
  "Sent to Buyers": "bg-sky text-ink",
  "Viewing Scheduled": "bg-sky-600/40 text-ink",
  "Offer Made": "bg-emerald-900/40 text-emerald-100",
  "Under Contract": "bg-emerald-800/50 text-emerald-100",
  Closed: "bg-emerald-700/60 text-white",
  Lost: "bg-red-900/40 text-red-100",
};

export const nis = (n: number | null | undefined) => (n == null ? "" : `₪${Math.round(n).toLocaleString("en-US")}`);
export const nisShort = (n: number | null | undefined) => (n == null ? "" : n >= 1_000_000 ? `₪${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.?0+$/, "")}M` : `₪${Math.round(n / 1000)}K`);
export const sqm = (n: number | null | undefined) => (n == null ? "" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} m²`);
export const pricePerSqm = (price: number | null | undefined, internal: number | null | undefined) => (price && internal ? Math.round(price / internal) : null);

export const parseJsonList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export type IlApartmentLike = { name: string; city: string | null; neighborhood: string | null; street: string | null; rooms: number | null; internalSqm: number | null; mirpesetSqm: number | null; priceNis: number | null; floor: number | null; direction: string | null; parking: number | null };

/** One line that says what the apartment is: "4 rooms · 99 m² + 12 m² mirpeset · 3rd floor · Rehavia, Jerusalem". */
export function apartmentLine(a: IlApartmentLike) {
  return [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? `${sqm(a.internalSqm)}${a.mirpesetSqm ? ` + ${sqm(a.mirpesetSqm)} mirpeset` : ""}` : null, a.floor != null ? `floor ${a.floor}` : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ");
}
