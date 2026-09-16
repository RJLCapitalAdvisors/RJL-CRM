import { feet, nis, parseJsonList, pricePerMeter, sqft, sqm, usdFmt } from "@/lib/israel";

/**
 * Merge values for RJL Israel templates: {{unit.rooms}}, {{unit.priceNis}}, {{unit.facts}} and the rest, filled from
 * an apartment, house or project row. Contact tokens ({{contact.firstName|there}}) are left for the send step,
 * which fills them per person (ilMerge in il-blasts.ts handles those).
 */
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : null);
const yn = (v: unknown) => (v === "Yes" || v === true ? "Yes" : v === "No" || v === false ? "No" : "");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ilUnitValues(kind: "projects" | "apartments" | "houses", r: Row, developer: string | null, counts?: { apartments: number; houses: number }, ilsPerUsd?: number | null): Record<string, string> {
  const price = num(r.priceNis);
  const ppm = pricePerMeter(price, num(r.internalSqm), num(r.mirpesetSqm));
  const v: Record<string, string> = {
    "unit.name": str(r.name),
    "unit.street": str(r.street),
    "unit.city": str(r.city),
    "unit.neighborhood": str(r.neighborhood),
    "unit.address": [str(r.street), str(r.city)].filter(Boolean).join(", "),
    "unit.place": [str(r.neighborhood), str(r.city)].filter(Boolean).join(", "),
    "unit.developer": developer ?? "",
    "unit.completionDate": str(r.completionDate),
    "unit.priceNis": price ? nis(price) : "",
    "unit.priceUsd": price && ilsPerUsd ? usdFmt(price / ilsPerUsd) : "",
    "unit.pricePerMeter": ppm ? nis(ppm) : "",
    "unit.description": str(r.description),
    "unit.rooms": num(r.rooms) ? String(num(r.rooms)) : "",
    "unit.internalSqm": num(r.internalSqm) ? sqm(num(r.internalSqm)) : "",
    "unit.internalSqft": num(r.internalSqm) ? sqft(num(r.internalSqm)) : "",
    "unit.mirpesetSqm": num(r.mirpesetSqm) ? sqm(num(r.mirpesetSqm)) : "",
    "unit.sellerType": str(r.sellerType).replace("Yad Rishona (developer)", "Yad rishona, from the developer"),
    "unit.parking": str(r.parkingSpots),
    "unit.mamad": r.mamad === true ? "Yes" : r.mamad === false ? "No" : "",
    "unit.privatePool": yn(r.pool) === "Yes" ? (num(r.poolSqm) ? `Yes, ${sqm(num(r.poolSqm))}` : "Yes") : yn(r.pool),
    "unit.apartmentType": str(r.apartmentType),
    "unit.floor": num(r.floor) != null ? (num(r.floor) === 0 ? "Ground floor" : String(num(r.floor))) : "",
    "unit.totalFloors": num(r.totalFloors) ? String(num(r.totalFloors)) : "",
    "unit.buildingUnits": num(r.buildingUnits) ? String(num(r.buildingUnits)) : "",
    "unit.levels": num(r.levels) ? String(num(r.levels)) : "",
    "unit.direction": parseJsonList(r.direction as string).join(", "),
    "unit.ceiling": num(r.ceilingCm) ? `${num(r.ceilingCm)} cm (${feet(num(r.ceilingCm))})` : "",
    "unit.machsan": num(r.machsanSqm) ? `${sqm(num(r.machsanSqm))}${str(r.machsanLocation) ? `, ${str(r.machsanLocation).toLowerCase()}` : ""}` : "",
    "unit.houseType": str(r.houseType),
    "unit.floors": num(r.floors) ? String(num(r.floors)) : "",
    "unit.migrashSqm": num(r.migrashSqm) ? sqm(num(r.migrashSqm)) : "",
    "unit.ceilings": parseJsonList(r.ceilingCms as string).filter(Boolean).map((c) => `${c} cm`).join(", "),
    "unit.totalUnits": num(r.totalUnits) ? String(num(r.totalUnits)) : "",
    "unit.stories": num(r.stories) ? String(num(r.stories)) : "",
    "unit.parkingSpaces": num(r.parkingSpaces) ? String(num(r.parkingSpaces)) : "",
    "unit.projectPool": kind === "projects" ? yn(r.pool) : "",
    "unit.available": counts ? [counts.apartments ? `${counts.apartments} apartments` : "", counts.houses ? `${counts.houses} houses` : ""].filter(Boolean).join(" and ") : "",
  };
  const factKeys: [string, string][] =
    kind === "projects"
      ? [["Address", "unit.address"], ["Developer", "unit.developer"], ["Total units", "unit.totalUnits"], ["Stories", "unit.stories"], ["Parking spaces", "unit.parkingSpaces"], ["Delivery", "unit.completionDate"], ["Project pool", "unit.projectPool"], ["Available now", "unit.available"]]
      : kind === "houses"
        ? [["Address", "unit.address"], ["Developer", "unit.developer"], ["Rooms", "unit.rooms"], ["Floors", "unit.floors"], ["Internal size", "unit.internalSqm"], ["Mirpeset", "unit.mirpesetSqm"], ["Migrash", "unit.migrashSqm"], ["Ceiling heights", "unit.ceilings"], ["Mamad", "unit.mamad"], ["Parking", "unit.parking"], ["Built or delivery", "unit.completionDate"], ["Seller", "unit.sellerType"], ["Private pool", "unit.privatePool"], ["Asking price", "unit.priceNis"]]
        : [["Address", "unit.address"], ["Developer", "unit.developer"], ["Rooms", "unit.rooms"], ["Internal size", "unit.internalSqm"], ["Mirpeset", "unit.mirpesetSqm"], ["Floor", "unit.floor"], ["Building stories", "unit.totalFloors"], ["Direction", "unit.direction"], ["Mamad", "unit.mamad"], ["Parking", "unit.parking"], ["Machsan", "unit.machsan"], ["Ceiling height", "unit.ceiling"], ["Built or delivery", "unit.completionDate"], ["Seller", "unit.sellerType"], ["Private pool", "unit.privatePool"], ["Asking price", "unit.priceNis"]];
  v["unit.facts"] = `<ul style="margin:0 0 10pt 18pt;padding:0;">${factKeys.filter(([, k]) => v[k] && v[k] !== "No").map(([label, k]) => `<li style="margin:0 0 3pt 0;"><b>${esc(label)}:</b> ${esc(v[k])}</li>`).join("")}</ul>`;
  return v;
}

/** Fill the unit tokens; contact and sender tokens stay for the per-person step. */
export function renderIlTemplate(text: string, values: Record<string, string>, sender?: string | null): string {
  return text.replace(/\{\{\s*((?:unit|sender)\.[a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_, key: string, fb?: string) => {
    const v = key === "sender.name" ? sender ?? "" : values[key] ?? "";
    return v || fb || "";
  });
}

/** {{contact.firstName|there}}, {{contact.lastName}}, {{contact.company}}, {{company.name}}, {{first}} filled in for one person. */
export function ilMerge(text: string, c: { firstName: string | null; lastName: string | null; company: string | null }): string {
  const val = (k: string) => (k === "firstName" || k === "first" ? c.firstName : k === "lastName" ? c.lastName : k === "company" || k === "name" ? c.company : null);
  return text.replace(/\{\{\s*(?:contact\.|company\.)?(firstName|lastName|company|first|name)\s*(?:\|([^}]*))?\}\}/g, (_, k: string, fb: string | undefined) => val(k)?.trim() || fb?.trim() || "");
}
