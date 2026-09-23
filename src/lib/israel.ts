/**
 * RJL Israel: apartments (the "deals" of that business), the people and firms around them, and the words
 * used for both. Kept separate from the RJL Capital Advisors data; where a choice is unclear, the RJL CA
 * conventions apply.
 */

/** Roles, the same word as in RJL Capital Advisors. A company's roles flow to its contacts; Seller is a person-only role. */
export const IL_SPONSOR = "Sponsor (Yazam)";
export const IL_COMPANY_ROLES = [IL_SPONSOR, "Kablan", "Broker", "Buyer", "Lender", "Attorneys", "Mortgage Broker", "Other"] as const;
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
    case "Lender":
      return "bg-violet-200 text-ink";
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
/** What a project offers its residents, ticked as a set (Jonathan, Sep 23, 2026); doorman, pool and gym stay as Yes/No fields derived from it. */
export const IL_AMENITIES = ["Doorman", "Pool", "Gym", "Jacuzzi", "Sauna", "Yoga/Pilates Studio", "Co-working spaces"] as const;
export const amenityFlags = (list: readonly string[]) => ({ doorman: list.includes("Doorman") ? "Yes" : "No", pool: list.includes("Pool") ? "Yes" : "No", gym: list.includes("Gym") ? "Yes" : "No" });
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

/** Mentioned: a property someone floated by email that never came in as a listing (src/lib/israel-mentions.ts). */
export const IL_DEAL_STAGES = ["Mentioned", "Lead", "Viewing Scheduled", "Offer Made", "Negotiation", "Under Contract", "Closed", "Lost"] as const;
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
    case "Mentioned":
      return "bg-amber-100 text-amber-900 border-amber-200";
    default:
      return "bg-cream text-ink border-line";
  }
}

// ---------- completeness and approval ----------
/**
 * Required Items Lists for RJL Israel: what a complete ticket carries, one list per kind of ticket. Jonathan edits
 * them on the Required Items Lists page; the defaults below seed the lists and stand in until loadIlRequired()
 * (src/lib/required-items.ts) has read his version. A key that is a ticket column is satisfied by that column; an
 * x_ key is a question with no column and its answer lives in the ticket's `extra` JSON. A ticket with anything
 * on its list blank waits under "Deals to be approved" on the dashboard until the data is chased down and approved.
 */
export type IlCategory = "projects" | "apartments" | "houses";
export type IlRequiredItem = { key: string; label: string; question?: string | null };
export const IL_CATEGORIES: { key: IlCategory; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "apartments", label: "Apartments" },
  { key: "houses", label: "Houses" },
];
export const IL_DEFAULT_REQUIRED: Record<IlCategory, IlRequiredItem[]> = {
  projects: [
    { key: "developerId", label: "Developer (the yazam building or selling it)" },
    { key: "street", label: "Address (street and number)" },
    { key: "city", label: "City" },
    { key: "neighborhood", label: "Neighborhood" },
    { key: "totalUnits", label: "Total units in the project" },
    { key: "stories", label: "Building stories (floors per building)" },
    { key: "parkingSpaces", label: "Parking spaces and configuration (how many in the project; underground or open)" },
    { key: "completionDate", label: "Expected delivery (month and year)" },
    { key: "amenities", label: "Amenities (doorman, pool, gym, jacuzzi, sauna, studio, co-working)" },
    { key: "brochureName", label: "Brochure (PDF)" },
  ],
  apartments: [
    { key: "developerId", label: "Developer (the yazam building or selling it)" },
    { key: "apartmentType", label: "Apartment type (regular, garden or penthouse)" },
    { key: "street", label: "Building address (street and number)" },
    { key: "city", label: "City" },
    { key: "neighborhood", label: "Neighborhood" },
    { key: "rooms", label: "Number of rooms (e.g. 3.5)" },
    { key: "completionDate", label: "Year of construction or expected date of delivery (month and year)" },
    { key: "floor", label: "Apartment floor (which floor the unit is on)" },
    { key: "totalFloors", label: "Total stories in the building" },
    { key: "buildingUnits", label: "Total units in the building" },
    { key: "direction", label: "Apartment direction (which way the windows face: north, south, east or west)" },
    { key: "mamad", label: "Mamad (yes or no)" },
    { key: "sellerType", label: "Seller type (yad rishona from the developer, or second hand)" },
    { key: "internalSqm", label: "Internal size (m², without the mirpeset)" },
    { key: "mirpesetSqm", label: "Mirpeset size (m²), each mirpeset separately if there is more than one" },
    { key: "mirpesetDirection", label: "Mirpeset direction (north, south, east or west)" },
    { key: "sukka", label: "Sukka on the mirpeset (yes, partial or no)" },
    { key: "pool", label: "Private pool (yes or no)" },
    { key: "ceilingCm", label: "Ceiling height (cm)" },
    { key: "parkingSpots", label: "Parking spots and configuration (how many; back to back or side by side; underground or open)" },
    { key: "machsanSqm", label: "Machsan (storage room) size (m²)" },
    { key: "machsanLocation", label: "Machsan location (in the unit, in the basement or by the parking)" },
    { key: "priceNis", label: "Asking price (NIS)" },
    { key: "floorplanName", label: "Floorplan (a picture or PDF of the unit's plan)" },
  ],
  houses: [
    { key: "houseType", label: "House type (villa, semi-attached or cottage)" },
    { key: "street", label: "Address (street and number)" },
    { key: "city", label: "City" },
    { key: "neighborhood", label: "Neighborhood" },
    { key: "rooms", label: "Number of rooms (e.g. 5.5)" },
    { key: "floors", label: "How many floors (miflasim)" },
    { key: "ceilingCms", label: "Ceiling height per floor (cm)" },
    { key: "completionDate", label: "Built or expected delivery (month and year)" },
    { key: "parkingSpots", label: "Parking spots and configuration (how many; covered or open)" },
    { key: "sellerType", label: "Seller type (yad rishona from the developer, or second hand)" },
    { key: "mamad", label: "Mamad (yes or no)" },
    { key: "internalSqm", label: "Internal size (m²)" },
    { key: "mirpesetSqm", label: "Mirpeset size (m²), each mirpeset separately if there is more than one" },
    { key: "mirpesetDirection", label: "Mirpeset direction (north, south, east or west)" },
    { key: "sukka", label: "Sukka on the mirpeset (yes, partial or no)" },
    { key: "pool", label: "Private pool (yes or no)" },
    { key: "migrashSqm", label: "Migrash (plot) size (m²)" },
    { key: "priceNis", label: "Asking price (NIS)" },
    { key: "floorplanName", label: "Floorplan (a picture or PDF of the house's plan)" },
  ],
};
/** The live lists (swapped in by loadIlRequired). */
export const IL_REQUIRED: Record<IlCategory, IlRequiredItem[]> = {
  projects: [...IL_DEFAULT_REQUIRED.projects],
  apartments: [...IL_DEFAULT_REQUIRED.apartments],
  houses: [...IL_DEFAULT_REQUIRED.houses],
};
export function setIlRequired(lists: Partial<Record<IlCategory, IlRequiredItem[]>>) {
  for (const c of IL_CATEGORIES) if (lists[c.key]) IL_REQUIRED[c.key].splice(0, IL_REQUIRED[c.key].length, ...lists[c.key]!);
}
export const isCustomKey = (k: string) => k.startsWith("x_");
/** Every developer on a ticket, the lead first: developerId plus the JSON list in developerIds (Jonathan, Sep 23, 2026: Mophet is Ramot Ba'ir with Adi Capital). */
export function developerIdList(row: { developerId?: string | null; developerIds?: string | null } | null | undefined): string[] {
  if (!row) return [];
  return [...new Set([row.developerId, ...parseJsonList(row.developerIds)].filter((x): x is string => Boolean(x)))];
}
/** The names of the developers after the lead, for a list cell: " + Adi Capital". */
export const coDeveloperNames = (row: { developerId?: string | null; developerIds?: string | null } | null | undefined, names: Map<string, string>) => developerIdList(row).slice(1).map((id) => names.get(id)).filter((x): x is string => Boolean(x));
/** The answers to list questions with no field of their own, from a ticket's `extra` JSON. */
export function parseExtra(v: unknown): Record<string, string> {
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    if (!o || typeof o !== "object") return {};
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, x]) => typeof x === "string" && x.trim()).map(([k, x]) => [k, (x as string).trim()]));
  } catch {
    return {};
  }
}
const listHas = (cat: IlCategory, key: string) => IL_REQUIRED[cat].some((i) => i.key === key);
/** Whether a listed item is still blank on a ticket row (a Prisma record as a plain object). */
const MIRPESET_KEYS = new Set(["mirpesetSqm", "mirpesetDirection", "mirpasot", "sukka", "sukkaSqm", "mirpesetCount"]);
function blankOn(row: Record<string, unknown>, key: string): boolean {
  if (isCustomKey(key)) return !parseExtra(row.extra)[key];
  if (row.mirpesetCount === 0 && MIRPESET_KEYS.has(key)) return false; // no mirpeset at all: nothing about one is missing (Sep 23, 2026)
  if (!(key in row)) return false; // no column of that name on this kind of ticket (the rules below cover sukka and pool)
  const v = row[key];
  if (v == null || v === "" || v === "[]") return true;
  if (key === "ceilingCms" && typeof v === "string") {
    const given = parseJsonList(v).filter((x) => x !== "").length;
    return given === 0 || (typeof row.floors === "number" && given < row.floors);
  }
  return false;
}
/** Sukka on every mirpeset, renovation year on a second-hand unit, project on a yad rishona apartment. */
function commonMissing(a: Record<string, unknown>, apartment: boolean): string[] {
  const out: string[] = [];
  const cat: IlCategory = apartment ? "apartments" : "houses";
  const list = parseMirpasot(typeof a.mirpasot === "string" ? a.mirpasot : "[]");
  const garden = a.apartmentType === "Garden apartment";
  if (listHas(cat, "sukka") && a.mirpesetSqm != null && (list.length === 0 || list.some((m) => !m.sukka))) out.push(list.length > 1 ? `Sukka (yes, partial or no) for each ${garden ? "garden" : "mirpeset"}` : "Sukka (yes, partial or no)");
  if (list.some((m) => m.sukka && m.sukka !== "No" && m.sukkaSqm == null)) out.push("Sukka area (m²)");
  if (a.pool === "Yes" && a.poolSqm == null) out.push("Pool size (m²)"); // the private pool is one question on the unit (the list's "pool" line covers yes or no)
  if (isSecondHand(typeof a.sellerType === "string" ? a.sellerType : null) && a.renovationYear == null) out.push("Year of renovation (or never renovated)");
  if (apartment && typeof a.sellerType === "string" && a.sellerType.startsWith("Yad Rishona") && !a.projectId && !a.projectName) out.push("Project name");
  return out;
}
/** Labels of the apartment list items still blank. Empty means complete. */
export function apartmentMissing(a: Record<string, unknown>): string[] {
  const base = IL_REQUIRED.apartments.filter(({ key }) => blankOn(a, key)).map((f) => f.label);
  return [...base, ...commonMissing(a, true)];
}
export function houseMissing(h: Record<string, unknown>): string[] {
  const base = IL_REQUIRED.houses.filter(({ key }) => blankOn(h, key)).map((f) => f.label);
  const extra = commonMissing(h, false);
  if (typeof h.sellerType === "string" && h.sellerType.startsWith("Yad Rishona") && !h.developerId && !listHas("houses", "developerId")) extra.push("Developer");
  return [...base, ...extra];
}
export function projectMissing(p: Record<string, unknown>): string[] {
  return IL_REQUIRED.projects.filter(({ key }) => blankOn(p, key)).map((f) => f.label);
}

/** The year in "2016" or "06/2027" or "Q2 2028"; null when there is none. */
export const yearOf = (s: string | null | undefined): number | null => {
  const m = s?.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};

/** "06/2027" or "1998" on a ticket -> "2027-06" / "1998-01" for a month picker. */
export const toMonthInput = (v: string | null | undefined): string => {
  if (!v) return "";
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  const my = v.match(/(\d{1,2})\s*\/\s*((?:19|20)\d{2})/);
  if (my) return `${my[2]}-${my[1].padStart(2, "0")}`;
  const y = v.match(/(?:19|20)\d{2}/);
  return y ? `${y[0]}-01` : "";
};
/**
 * What a month picker posted, back onto the ticket as "MM/YYYY". When the picker still shows what the ticket already
 * had (a year-only "1998" shows as 1998-01), the ticket's own value is kept, so an untouched field never rewrites itself.
 */
export const monthFromForm = (posted: string | null, orig: string | null): string | null => {
  if (!posted) return null;
  if (orig && toMonthInput(orig) === posted) return orig;
  const m = posted.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : posted;
};
