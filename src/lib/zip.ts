import { prisma } from "@/lib/db";

/**
 * The full property address for a deal email: street, city, state and zip (Jonathan, Oct 19, 2026: "the address should
 * always contain the full address, including city state and zip code"). The zip is not a ticket column: it is looked up
 * once from the street and city (Nominatim, the same service the Israel map uses) and kept in details.zip.
 */
type DealLike = { propertyAddress?: string | null; city?: string | null; state?: string | null; details?: string | null };

const zipOf = (details: string | null | undefined): string | null => {
  try {
    const z = (JSON.parse(details || "{}") as { zip?: unknown }).zip;
    return typeof z === "string" && /^\d{5}(-\d{4})?$/.test(z) ? z : null;
  } catch {
    return null;
  }
};

/** The three-digit zip prefixes each state uses, so a zip from the wrong state (or a typo in the map data) is refused. */
const ZIP_RANGES: Record<string, [number, number][]> = {
  AL: [[350, 369]], AK: [[995, 999]], AZ: [[850, 865]], AR: [[716, 729]], CA: [[900, 961]], CO: [[800, 816]], CT: [[60, 69]], DE: [[197, 199]], DC: [[200, 205]], FL: [[320, 349]],
  GA: [[300, 319], [398, 399]], HI: [[967, 968]], ID: [[832, 838]], IL: [[600, 629]], IN: [[460, 479]], IA: [[500, 528]], KS: [[660, 679]], KY: [[400, 427]], LA: [[700, 714]], ME: [[39, 49]],
  MD: [[206, 219]], MA: [[10, 27], [55, 55]], MI: [[480, 499]], MN: [[550, 567]], MS: [[386, 397]], MO: [[630, 658]], MT: [[590, 599]], NE: [[680, 693]], NV: [[889, 898]], NH: [[30, 38]],
  NJ: [[70, 89]], NM: [[870, 884]], NY: [[100, 149], [5, 5]], NC: [[270, 289]], ND: [[580, 588]], OH: [[430, 459]], OK: [[730, 749]], OR: [[970, 979]], PA: [[150, 196]], RI: [[28, 29]],
  SC: [[290, 299]], SD: [[570, 577]], TN: [[370, 385]], TX: [[750, 799], [885, 885]], UT: [[840, 847]], VT: [[50, 59]], VA: [[220, 246], [201, 201]], WA: [[980, 994]], WV: [[247, 268]], WI: [[530, 549]], WY: [[820, 831]],
};
export function zipInState(zip: string, state: string): boolean {
  const ranges = ZIP_RANGES[state.toUpperCase()];
  if (!ranges) return true;
  const p = Number(zip.slice(0, 3));
  return ranges.some(([lo, hi]) => p >= lo && p <= hi);
}

/** "2300 Enterprise Place, Kingsport, TN 37660"; a street that already carries the city and state is not doubled. */
export function fullAddress(d: DealLike | null | undefined): string {
  if (!d) return "";
  const street = (d.propertyAddress ?? "").trim();
  const city = (d.city ?? "").trim(), state = (d.state ?? "").trim();
  const zip = zipOf(d.details);
  if (!street) return [city, state].filter(Boolean).join(", ");
  // the street carries the city only as its own part after a comma ("TBD 174th Rd, Arlington, WA"); "Tualatin-Sherwood Rd" does not carry Tualatin
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasCity = Boolean(city) && new RegExp(`,\\s*${esc(city)}\\s*(,|$|\\s+[A-Z]{2}\\b)`, "i").test(street);
  const hasState = Boolean(state) && new RegExp(`,\\s*${esc(state)}\\b|\\b${esc(state)}\\s+\\d{5}\\b`).test(street);
  const tail = [hasCity ? "" : city, hasState ? "" : state].filter(Boolean);
  let out = tail.length ? `${street}, ${tail.join(", ")}` : street;
  if (zip && !street.includes(zip)) out = `${out} ${zip}`;
  return out;
}

/** The zip for a deal, looked up and stored when the ticket has none and the street and city are known. */
export async function ensureZip(dealId: string): Promise<string | null> {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { propertyAddress: true, city: true, state: true, details: true } });
  if (!d) return null;
  // a zip already in the street is one that follows the state code or ends the line; "21660 Overseas Highway" is a house number
  const have = zipOf(d.details) ?? d.propertyAddress?.match(/\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b|\b(\d{5})(?:-\d{4})?\s*$/)?.slice(1).find(Boolean) ?? null;
  if (have) return have;
  if (!d.propertyAddress || !d.city) return null;
  const street = d.propertyAddress.split(/[,(]/)[0].replace(/\b(and|&)\b.*$/i, "").trim(); // "4670 and 4730 S Fort Apache Rd" asks for the first
  if (!/\d/.test(street)) return null; // no house number: a zip from the city alone could be wrong
  const q = `${street}, ${d.city}, ${d.state ?? ""}, USA`;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "RJL CRM (jonathan@rjlcapadvisors.com)" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const hits = (await res.json()) as { address?: Record<string, string | undefined> }[];
    const addr = hits[0]?.address ?? {};
    const zip = addr.postcode?.match(/^\d{5}/)?.[0] ?? null;
    // the hit has to be in the deal's state and name its city, or it is some other street of that name (Park Station in
    // Gaithersburg, MD came back with a South Carolina zip)
    const hitState = (addr["ISO3166-2-lvl4"] ?? "").replace(/^US-/, "");
    const hitPlaces = [addr.city, addr.town, addr.village, addr.hamlet, addr.municipality, addr.county, addr.suburb].filter(Boolean).map((x) => x!.toLowerCase());
    const cityOk = hitPlaces.some((p) => p.includes(d.city!.toLowerCase()) || d.city!.toLowerCase().includes(p));
    if (!zip || (d.state && hitState && hitState !== d.state) || !cityOk) return null;
    if (d.state && !zipInState(zip, d.state)) return null; // the map's own typo (Gaithersburg, MD as 29877; Redmond, OR as 91156)
    const details = (() => { try { return JSON.parse(d.details || "{}") as Record<string, unknown>; } catch { return {}; } })();
    await prisma.deal.update({ where: { id: dealId }, data: { details: JSON.stringify({ ...details, zip }) } });
    return zip;
  } catch {
    return null;
  }
}
