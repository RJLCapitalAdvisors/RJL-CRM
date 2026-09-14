/**
 * RJL Israel: apartments (the "deals" of that business), the people and firms around them, and the words
 * used for both. Kept separate from the RJL Capital Advisors data; where a choice is unclear, the RJL CA
 * conventions apply.
 */

/** Roles, the same word as in RJL Capital Advisors. A company's roles flow to its contacts; Seller is a person-only role. */
export const IL_SPONSOR = "Sponsor (Yazam)";
export const IL_COMPANY_ROLES = [IL_SPONSOR, "Kablan", "Broker", "Buyer", "Attorneys", "Mortgage Broker", "Other"] as const;
export const IL_SPONSOR_FOCUS = ["Development", "Acquisitions", "Both"] as const;
export const IL_ROLES = [...IL_COMPANY_ROLES, "Seller"] as const;
export function ilRoleColor(role: string): string {
  switch (role) {
    case "Sponsor (Yazam)":
      return "bg-ink text-white";
    case "Kablan":
      return "bg-orange-200 text-ink";
    case "Broker":
      return "bg-stone-200 text-ink";
    case "Buyer":
      return "bg-sky text-ink";
    case "Seller":
      return "bg-sky/50 text-ink";
    case "Attorneys":
      return "bg-amber-200 text-ink";
    case "Mortgage Broker":
      return "bg-emerald-200 text-ink";
    default:
      return "bg-stone-100 text-ink";
  }
}
/** Union of two JSON role lists, in option order. */
export const mergeIlRoles = (a: string | string[] | null | undefined, b: string | string[] | null | undefined) => {
  const la = Array.isArray(a) ? a : parseJsonList(a ?? "[]");
  const lb = Array.isArray(b) ? b : parseJsonList(b ?? "[]");
  const set = new Set([...la, ...lb]);
  return JSON.stringify((IL_ROLES as readonly string[]).filter((r) => set.has(r)));
};
export const IL_DIRECTIONS = ["North", "South", "East", "West"] as const;
export const IL_PARKING = ["None", "1", "2 - back to back", "2 side by side", "3"] as const;
export const IL_MACHSAN_LOCATIONS = ["Attached to apartment", "In basement"] as const;
export const IL_SELLER_TYPES = ["Yad Rishona (developer)", "Second hand, never occupied", "Second hand, occupied"] as const;
export const isSecondHand = (t: string | null | undefined) => Boolean(t && t.startsWith("Second hand"));
/** Dollars per square foot on the same area basis as price per meter (internal plus one third of the mirpeset). */
export const usdPerSqft = (priceNis: number | null | undefined, internal: number | null | undefined, mirpeset: number | null | undefined, ilsPerUsd: number | null | undefined) => {
  if (!priceNis || !internal || !ilsPerUsd) return null;
  const areaSqft = (internal + (mirpeset ?? 0) / 3) * SQFT_PER_SQM;
  return areaSqft > 0 ? Math.round(priceNis / ilsPerUsd / areaSqft) : null;
};
export const IL_CITIES = ["Jerusalem", "Tel Aviv", "Herzliya", "Ra'anana", "Netanya", "Modi'in", "Beit Shemesh", "Ramat Gan", "Givatayim", "Haifa", "Ashdod", "Ashkelon", "Petah Tikva", "Rehovot", "Efrat", "Ma'ale Adumim"] as const;

export const SQFT_PER_SQM = 10.7639;
export const ACRES_PER_SQM = 1 / 4046.8564; // a dunam is 1,000 m²
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

export const IL_SUKKA = ["Yes", "Partial", "No"] as const;
export const IL_HOUSE_TYPES = ["Villa", "Semi-attached", "Cottage"] as const;
export const IL_APARTMENT_TYPES = ["Regular apartment", "Garden apartment", "Penthouse"] as const;
export const isGardenApartment = (t: string | null | undefined) => t === "Garden apartment";
export type Mirpeset = { sqm: number | null; direction: string[]; sukka: string | null; sukkaSqm: number | null; pool: string | null; poolSqm: number | null };
/** The mirpasot list stored on a ticket with more than one mirpeset. */
export const parseMirpasot = (s: string | null | undefined): Mirpeset[] => {
  try {
    const v = JSON.parse(s || "[]");
    const num = (x: unknown) => (typeof x === "number" && !isNaN(x) ? x : null);
    const str = (x: unknown) => (typeof x === "string" && x ? x : null);
    return Array.isArray(v) ? v.map((m) => ({ sqm: num(m?.sqm), direction: Array.isArray(m?.direction) ? m.direction.map(String) : [], sukka: str(m?.sukka), sukkaSqm: num(m?.sukkaSqm), pool: str(m?.pool), poolSqm: num(m?.poolSqm) })) : [];
  } catch {
    return [];
  }
};
export const IL_APARTMENT_LEVELS = ["1", "2", "3"] as const;
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

export type IlHouseLike = { name: string; city: string | null; neighborhood: string | null; street: string | null; rooms: number | null; internalSqm: number | null; migrashSqm: number | null; floors: number | null; priceNis: number | null };
export function houseLine(h: IlHouseLike) {
  return [h.rooms ? `${h.rooms} rooms` : null, h.internalSqm ? sqm(h.internalSqm) : null, h.migrashSqm ? `${sqm(h.migrashSqm)} migrash` : null, h.floors ? `${h.floors} floors` : null, [h.neighborhood, h.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ");
}
export const ilFullName = (c: { firstName: string | null; lastName: string | null; email: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(no name)";

export const IL_DEAL_STAGES = ["Lead", "Viewing Scheduled", "Offer Made", "Negotiation", "Under Contract", "Closed", "Lost"] as const;
export function ilStageTone(stage: string): string {
  switch (stage) {
    case "Closed":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "Lost":
      return "bg-stone-100 text-stone-600 border-stone-200";
    case "Under Contract":
    case "Negotiation":
      return "bg-sky text-white border-sky";
    case "Offer Made":
      return "bg-sky-50 text-ink border-sky";
    default:
      return "bg-cream text-ink border-line";
  }
}

// ---------- completeness and approval ----------
/**
 * What a ticket needs before it counts as complete. An apartment that arrives by email with any of these blank
 * waits under "Deals to be approved" on the dashboard until the data is chased down and Jonathan approves it.
 * Edit this list to change the rule.
 */
export const IL_COMPLETE_FIELDS: { key: string; label: string }[] = [
  { key: "developerId", label: "Developer" },
  { key: "apartmentType", label: "Apartment type (regular, garden or penthouse)" },
  { key: "street", label: "Building address" },
  { key: "city", label: "City" },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "rooms", label: "Rooms" },
  { key: "completionDate", label: "Year of construction or expected delivery" },
  { key: "internalSqm", label: "Internal m²" },
  { key: "mirpesetSqm", label: "Mirpeset size" },
  { key: "priceNis", label: "Asking price" },
  { key: "sellerType", label: "Seller type" },
  { key: "ceilingCm", label: "Ceiling height" },
  { key: "parkingSpots", label: "Parking spots" },
  { key: "machsanSqm", label: "Machsan size" },
  { key: "machsanLocation", label: "Machsan location" },
  { key: "direction", label: "Apartment direction" },
  { key: "mirpesetDirection", label: "Mirpeset direction" },
  { key: "totalFloors", label: "Building stories" },
  { key: "buildingUnits", label: "Total building units" },
  { key: "floor", label: "Apartment floor" },
];
/** Sukka on every mirpeset, renovation year on a second-hand unit, project on a yad rishona apartment. */
function commonMissing(a: Record<string, unknown>, apartment: boolean): string[] {
  const out: string[] = [];
  const list = parseMirpasot(typeof a.mirpasot === "string" ? a.mirpasot : "[]");
  const garden = a.apartmentType === "Garden apartment";
  if (a.mirpesetSqm != null && (list.length === 0 || list.some((m) => !m.sukka))) out.push(list.length > 1 ? `Sukka (yes, partial or no) for each ${garden ? "garden" : "mirpeset"}` : "Sukka (yes, partial or no)");
  if (list.some((m) => m.sukka && m.sukka !== "No" && m.sukkaSqm == null)) out.push("Sukka area (m²)");
  if (apartment && list.length && list.some((m) => !m.pool)) out.push("Pool (yes or no)");
  if (list.some((m) => m.pool === "Yes" && m.poolSqm == null)) out.push("Pool size (m²)");
  if (!apartment && a.pool === "Yes" && a.poolSqm == null) out.push("Pool size (m²)");
  if (isSecondHand(typeof a.sellerType === "string" ? a.sellerType : null) && a.renovationYear == null) out.push("Year of renovation (or never renovated)");
  if (apartment && typeof a.sellerType === "string" && a.sellerType.startsWith("Yad Rishona") && !a.projectId && !a.projectName) out.push("Project name");
  return out;
}
/** Labels of the complete-ticket fields still blank on an apartment. Empty means complete. */
export function apartmentMissing(a: Record<string, unknown>): string[] {
  const base = IL_COMPLETE_FIELDS.filter(({ key }) => {
    const v = a[key];
    if (v == null || v === "") return true;
    if (typeof v === "string" && (key === "direction" || key === "mirpesetDirection")) return parseJsonList(v).length === 0;
    return false;
  }).map((f) => f.label);
  return [...base, ...commonMissing(a, true)];
}

/** What a complete house ticket carries; the dashboard and the reply list whichever are blank. */
export const IL_HOUSE_COMPLETE_FIELDS: { key: string; label: string }[] = [
  { key: "houseType", label: "House type" },
  { key: "street", label: "Address" },
  { key: "city", label: "City" },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "rooms", label: "Rooms" },
  { key: "completionDate", label: "Built or expected delivery" },
  { key: "internalSqm", label: "Internal m²" },
  { key: "mirpesetSqm", label: "Mirpeset size" },
  { key: "mirpesetDirection", label: "Mirpeset direction" },
  { key: "floors", label: "How many floors" },
  { key: "ceilingCms", label: "Ceiling heights" },
  { key: "migrashSqm", label: "Migrash size" },
  { key: "pool", label: "Pool" },
  { key: "priceNis", label: "Asking price" },
  { key: "sellerType", label: "Seller type" },
  { key: "parkingSpots", label: "Parking" },
];
export function houseMissing(h: Record<string, unknown>): string[] {
  const base = IL_HOUSE_COMPLETE_FIELDS.filter(({ key }) => {
    const v = h[key];
    if (v == null || v === "") return true;
    if (key === "ceilingCms" && typeof v === "string") {
      const given = parseJsonList(v).filter((x) => x !== "").length;
      return given === 0 || (typeof h.floors === "number" && given < h.floors);
    }
    if (key === "mirpesetDirection" && typeof v === "string") return parseJsonList(v).length === 0;
    return false;
  }).map((f) => f.label);
  const extra = commonMissing(h, false);
  if (typeof h.sellerType === "string" && h.sellerType.startsWith("Yad Rishona") && !h.developerId) extra.push("Developer");
  return [...base, ...extra];
}

/** The year in "2016" or "06/2027" or "Q2 2028"; null when there is none. */
export const yearOf = (s: string | null | undefined): number | null => {
  const m = s?.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};
