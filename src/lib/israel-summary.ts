import { feet, nis, parseJsonList, pricePerMeter, sqft, sqm } from "@/lib/israel";

/**
 * The summary email for an apartment, a house or a project, written from whatever the ticket holds today. The
 * ticket page shows it as a preview (so a gap in the data shows up as a gap in the email), and the Send page
 * starts from it. "{{first}}" is the recipient's first name, filled in per person at send time. No dashes.
 */
export type SummaryEmail = { subject: string; html: string; text: string };
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : null);
const yn = (v: unknown) => (v === "Yes" ? "Yes" : v === "No" ? "No" : v === true ? "Yes" : v === false ? "No" : null);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;";

function build(kind: string, name: string, where: string, intro: string, facts: [string, string | null][], description: string | null, extraNames: string[]): SummaryEmail {
  const rows = facts.filter((f): f is [string, string] => Boolean(f[1]));
  const subject = [name, where].filter(Boolean).join(" · ");
  const list = rows.map(([k, v]) => `<li style="margin:0 0 3pt 0;"><b>${esc(k)}:</b> ${esc(v)}</li>`).join("");
  const html = `<div style="${F}">
<p style="margin:0 0 10pt 0;">Hi {{first}},</p>
<p style="margin:0 0 10pt 0;">${esc(intro)}</p>
<ul style="margin:0 0 10pt 18pt;padding:0;">${list}</ul>
${description ? `<p style="margin:0 0 10pt 0;">${esc(description)}</p>` : ""}
<p style="margin:0 0 10pt 0;">Happy to send ${extraNames.length ? extraNames.join(", ") + " and " : ""}more details, or set up a viewing.</p>
</div>`;
  const text = [`Hi {{first}},`, "", intro, "", ...rows.map(([k, v]) => `${k}: ${v}`), ...(description ? ["", description] : []), "", `Happy to send ${extraNames.length ? extraNames.join(", ") + " and " : ""}more details, or set up a viewing.`].join("\n");
  return { subject, html, text };
}

const place = (r: Row) => [str(r.neighborhood), str(r.city)].filter(Boolean).join(", ");
const priceLine = (r: Row, ppm: number | null) => (num(r.priceNis) ? `${nis(num(r.priceNis))}${ppm ? ` (${nis(ppm)} per m²)` : ""}` : null);
const sizeLine = (internal: number | null, mirpeset: number | null, word: string) => (internal ? `${sqm(internal)} internal (${sqft(internal)})${mirpeset ? ` plus ${sqm(mirpeset)} ${word}` : ""}` : mirpeset ? `${sqm(mirpeset)} ${word}` : null);

export function apartmentSummary(a: Row, developer: string | null, extras: string[] = []): SummaryEmail {
  const type = str(a.apartmentType)?.toLowerCase() ?? "apartment";
  const garden = /garden/.test(type);
  const ppm = pricePerMeter(num(a.priceNis), num(a.internalSqm), num(a.mirpesetSqm));
  const intro = `Sharing ${/^[aeiou]/.test(type) ? "an" : "a"} ${type}${place(a) ? ` in ${place(a)}` : ""} that may fit what you are looking for.`;
  const floor = num(a.floor) != null ? `${num(a.floor) === 0 ? "Ground floor" : `Floor ${num(a.floor)}`}${num(a.totalFloors) ? ` of ${num(a.totalFloors)}` : ""}` : null;
  const facts: [string, string | null][] = [
    ["Address", [str(a.street), str(a.city)].filter(Boolean).join(", ") || null],
    ["Project", str(a.projectName)],
    ["Developer", developer],
    ["Rooms", num(a.rooms) ? String(num(a.rooms)) : null],
    ["Size", sizeLine(num(a.internalSqm), num(a.mirpesetSqm), garden ? "garden" : "mirpeset")],
    ["Floor", floor],
    ["Levels", num(a.levels) && num(a.levels)! > 1 ? `${num(a.levels)} levels` : null],
    ["Direction", parseJsonList(a.direction as string).join(", ") || null],
    ["Mamad", a.mamad === true ? "Yes" : null],
    ["Parking", str(a.parkingSpots)],
    ["Machsan", num(a.machsanSqm) ? `${sqm(num(a.machsanSqm))}${str(a.machsanLocation) ? `, ${str(a.machsanLocation)!.toLowerCase()}` : ""}` : null],
    ["Ceiling height", num(a.ceilingCm) ? `${num(a.ceilingCm)} cm (${feet(num(a.ceilingCm))})` : null],
    ["Built or delivery", str(a.completionDate)],
    ["Seller", str(a.sellerType)?.replace("Yad Rishona (developer)", "Yad rishona, from the developer") ?? null],
    ["Private pool", yn(a.pool) === "Yes" ? (num(a.poolSqm) ? `Yes, ${sqm(num(a.poolSqm))}` : "Yes") : null],
    ["Asking price", priceLine(a, ppm)],
  ];
  return build("apartment", str(a.name) ?? "Apartment", place(a), intro, facts, str(a.description), extras);
}

export function houseSummary(h: Row, developer: string | null, extras: string[] = []): SummaryEmail {
  const type = str(h.houseType)?.toLowerCase() ?? "house";
  const ppm = pricePerMeter(num(h.priceNis), num(h.internalSqm), num(h.mirpesetSqm));
  const intro = `Sharing a ${type}${place(h) ? ` in ${place(h)}` : ""} that may fit what you are looking for.`;
  const ceilings = parseJsonList(h.ceilingCms as string).filter(Boolean);
  const facts: [string, string | null][] = [
    ["Address", [str(h.street), str(h.city)].filter(Boolean).join(", ") || null],
    ["Developer", developer],
    ["Rooms", num(h.rooms) ? String(num(h.rooms)) : null],
    ["Floors", num(h.floors) ? String(num(h.floors)) : null],
    ["Size", sizeLine(num(h.internalSqm), num(h.mirpesetSqm), "mirpeset")],
    ["Migrash", num(h.migrashSqm) ? `${sqm(num(h.migrashSqm))} (${(num(h.migrashSqm)! / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} dunam)` : null],
    ["Ceiling heights", ceilings.length ? ceilings.map((c) => `${c} cm`).join(", ") : null],
    ["Mamad", h.mamad === true ? "Yes" : null],
    ["Parking", str(h.parkingSpots)],
    ["Built or delivery", str(h.completionDate)],
    ["Seller", str(h.sellerType)?.replace("Yad Rishona (developer)", "Yad rishona, from the developer") ?? null],
    ["Private pool", yn(h.pool) === "Yes" ? (num(h.poolSqm) ? `Yes, ${sqm(num(h.poolSqm))}` : "Yes") : null],
    ["Asking price", priceLine(h, ppm)],
  ];
  return build("house", str(h.name) ?? "House", place(h), intro, facts, str(h.description), extras);
}

export function projectSummary(p: Row, developer: string | null, counts: { apartments: number; houses: number }, extras: string[] = []): SummaryEmail {
  const intro = `Sharing a project${place(p) ? ` in ${place(p)}` : ""} that may fit what you are looking for.`;
  const units = [counts.apartments ? `${counts.apartments} apartments` : null, counts.houses ? `${counts.houses} houses` : null].filter(Boolean).join(" and ");
  const facts: [string, string | null][] = [
    ["Address", [str(p.street), str(p.city)].filter(Boolean).join(", ") || null],
    ["Developer", developer],
    ["Total units", num(p.totalUnits) ? String(num(p.totalUnits)) : null],
    ["Stories", num(p.stories) ? String(num(p.stories)) : null],
    ["Parking spaces", num(p.parkingSpaces) ? String(num(p.parkingSpaces)) : null],
    ["Delivery", str(p.completionDate)],
    ["Project pool", yn(p.pool)],
    ["Available now", units || null],
  ];
  return build("project", str(p.name) ?? "Project", place(p), intro, facts, str(p.description), extras);
}

/** The email for one recipient. */
export const personalize = (t: string, firstName: string | null | undefined) => t.replace(/\{\{\s*first\s*\}\}/g, firstName?.trim() || "there");
