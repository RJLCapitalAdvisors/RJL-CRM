import { prisma } from "@/lib/db";
import { IL_AMENITIES, amenityFlags, monthFromForm, reconcileMirpasot } from "@/lib/israel";

/**
 * How a posted form becomes an apartment, a house or a project row (moved out of src/app/israel/actions.ts on Oct 6,
 * 2026 so the public submission forms read a posted form exactly the way the tickets do). The ticket pages and the
 * submission forms post the same field names, so one reading serves both.
 */
export const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
export const n = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v == null) return null;
  const x = Number(v.replace(/[^0-9.\-]/g, ""));
  return isNaN(x) ? null : x;
};
export const i = (fd: FormData, k: string) => {
  const x = n(fd, k);
  return x == null ? null : Math.trunc(x);
};
export const list = (fd: FormData, k: string) => JSON.stringify(fd.getAll(k).map(String).filter(Boolean));
export const yesNo = (fd: FormData, k: string) => (fd.has(k) ? s(fd, k) === "Yes" : undefined);

/**
 * The mirpasot of an apartment or a house from the form. One mirpeset: the single size and direction fields.
 * More than one: a size and a direction per mirpeset, summed into mirpesetSqm and unioned into mirpesetDirection
 * so price per meter, filters and compare work on the totals.
 */
export function mirpasotFrom(fd: FormData) {
  const raw = s(fd, "mirpesetCount");
  if (raw === "None") return { mirpesetCount: 0, mirpesetSqm: null, mirpesetDirection: "[]", mirpasot: "[]" }; // no mirpeset at all
  const count = i(fd, "mirpesetCount");
  if (!count || count <= 1) {
    const sukka = s(fd, "sukka");
    const single = { sqm: n(fd, "mirpesetSqm"), direction: fd.getAll("mirpesetDirection").map(String).filter(Boolean), sukka, sukkaSqm: sukka && sukka !== "No" ? n(fd, "sukkaSqm") : null, pool: null, poolSqm: null };
    return { mirpesetCount: count ?? (single.sqm != null ? 1 : null), mirpesetSqm: single.sqm, mirpesetDirection: JSON.stringify(single.direction), mirpasot: JSON.stringify(single.sqm != null || single.direction.length || single.sukka ? [single] : []) };
  }
  const sizes = fd.getAll("mirpasotSqm").map((v) => {
    const x = Number(String(v).replace(/[^0-9.]/g, ""));
    return String(v).trim() && !isNaN(x) ? x : null;
  });
  const items = Array.from({ length: Math.min(count, 3) }, (_, k) => {
    const sukka = s(fd, `mirpasotSukka_${k}`);
    return { sqm: sizes[k] ?? null, direction: fd.getAll(`mirpasotDir_${k}`).map(String).filter(Boolean), sukka, sukkaSqm: sukka && sukka !== "No" ? n(fd, `mirpasotSukkaSqm_${k}`) : null, pool: null, poolSqm: null };
  });
  // a typed total is the truth: the parts are fitted to it (Jonathan, Sep 23, 2026)
  const stated = n(fd, "mirpesetTotalSqm");
  const fitted = stated != null ? reconcileMirpasot(stated, items) : items;
  const total = fitted.reduce((a, m) => a + (m.sqm ?? 0), 0);
  const dirs = [...new Set(fitted.flatMap((m) => m.direction))];
  return { mirpesetCount: count, mirpesetSqm: stated ?? (fitted.some((m) => m.sqm != null) ? total : null), mirpesetDirection: JSON.stringify(dirs), mirpasot: JSON.stringify(fitted) };
}
/** Ceiling heights typed one per floor or level, in the order the form shows them. */
export function ceilingsFrom(fd: FormData, count: number | null) {
  const all = fd.getAll("ceilingCm").map((v) => {
    const x = Number(String(v).replace(/[^0-9.]/g, ""));
    return String(v).trim() && !isNaN(x) ? x : "";
  });
  return count ? all.slice(0, Math.max(0, count)) : all;
}

export function apartmentData(fd: FormData) {
  const levels = i(fd, "levels");
  const ceilings = ceilingsFrom(fd, levels);
  const firstCeiling = ceilings.find((c): c is number => c !== "") ?? null;
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "Apartment"),
    apartmentType: s(fd, "apartmentType"),
    degem: s(fd, "degem"),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    projectId: s(fd, "projectId"),
    rooms: n(fd, "rooms"),
    bathrooms: n(fd, "bathrooms"),
    completionDate: monthFromForm(s(fd, "completionDate"), s(fd, "completionDateOrig")),
    floor: i(fd, "floor"),
    totalFloors: i(fd, "totalFloors"),
    buildingUnits: i(fd, "buildingUnits"),
    internalSqm: n(fd, "internalSqm"),
    ...mirpasotFrom(fd),
    pool: s(fd, "pool"),
    poolSqm: s(fd, "pool") === "Yes" ? n(fd, "poolSqm") : null,
    // one level keeps the single ceiling; a duplex or triplex stores one per level and the first stands in for the single field
    levels,
    ceilingCms: JSON.stringify(levels && levels > 1 ? ceilings : []),
    ceilingCm: levels && levels > 1 ? firstCeiling : n(fd, "ceilingCm"),
    machsan: s(fd, "machsan"),
    machsanSqm: s(fd, "machsan") === "No" ? null : n(fd, "machsanSqm"),
    machsanLocation: s(fd, "machsan") === "No" ? null : s(fd, "machsanLocation"),
    parkingSpots: s(fd, "parkingSpots"),
    direction: list(fd, "direction"),
    mamad: yesNo(fd, "mamad") ?? null,
    priceNis: n(fd, "priceNis"),
    sellerType: s(fd, "sellerType"),
    renovationYear: s(fd, "sellerType")?.startsWith("Second hand") ? i(fd, "renovationYear") : null,
    description: s(fd, "description"),
  };
}

export function houseData(fd: FormData) {
  const floors = i(fd, "floors");
  const ceilings = ceilingsFrom(fd, floors);
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "House"),
    houseType: s(fd, "houseType"),
    projectId: s(fd, "projectId"),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    rooms: n(fd, "rooms"),
    floors,
    ceilingCms: JSON.stringify(ceilings),
    completionDate: monthFromForm(s(fd, "completionDate"), s(fd, "completionDateOrig")),
    internalSqm: n(fd, "internalSqm"),
    ...mirpasotFrom(fd),
    migrashSqm: n(fd, "migrashSqm"),
    pool: s(fd, "housePool"),
    poolSqm: s(fd, "housePool") === "Yes" ? n(fd, "housePoolSqm") : null,
    parkingSpots: s(fd, "parkingSpots"),
    sellerType: s(fd, "sellerType"),
    renovationYear: s(fd, "sellerType")?.startsWith("Second hand") ? i(fd, "renovationYear") : null,
    mamad: yesNo(fd, "mamad") ?? null,
    priceNis: n(fd, "priceNis"),
    description: s(fd, "description"),
  };
}

/** The developers ticked on a project form, as ids (lead first). */
export async function developersFromForm(fd: FormData): Promise<{ developerId: string | null; developerIds: string | null }> {
  const names = fd.getAll("developers").map(String).map((x) => x.trim()).filter(Boolean);
  if (!names.length) return { developerId: null, developerIds: null };
  const rows = await prisma.ilCompany.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  const ids = names.map((n) => rows.find((r) => r.name === n)?.id).filter((x): x is string => Boolean(x));
  return { developerId: ids[0] ?? null, developerIds: ids.length ? JSON.stringify(ids) : null };
}

export async function projectData(fd: FormData) {
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "Project"),
    ...(fd.has("developersSet") ? await developersFromForm(fd) : { developerId: s(fd, "developerId") }),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    totalUnits: i(fd, "totalUnits"),
    parkingSpaces: i(fd, "parkingSpaces"),
    stories: i(fd, "stories"),
    completionDate: monthFromForm(s(fd, "completionDate"), s(fd, "completionDateOrig")),
    ...(fd.has("amenitiesSet") ? (() => { const ticked = fd.getAll("amenities").map(String); const yes = IL_AMENITIES.filter((x) => ticked.includes(x) || fd.get(`amenity:${x}`) === "Yes"); const no = IL_AMENITIES.filter((x) => fd.get(`amenity:${x}`) === "No" && !yes.includes(x)); return { amenities: JSON.stringify(yes), amenitiesNo: JSON.stringify(no), ...amenityFlags(yes, no) }; })() : { doorman: s(fd, "doorman") }),
    ...(fd.has("amenitiesSet") ? {} : { pool: s(fd, "pool") }),
    ...(fd.has("amenitiesSet") ? {} : { gym: s(fd, "gym") }),
    description: s(fd, "description"),
  };
}
