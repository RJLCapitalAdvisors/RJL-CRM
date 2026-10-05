import { prisma } from "@/lib/db";

/**
 * The Rents (Jonathan, Oct 5, 2026): asking rents by neighborhood and room count, typed on the Rents page, give every
 * apartment an expected rent and an expected yield (rent × 12 ÷ asking price), and the Map View a yield heat map.
 * A ticket is matched to its neighborhood by its pin when it has one (the nearest neighborhood within 2.5 km, the
 * same city preferred), else by the neighborhood and city written on it. Rooms are matched to the nearest whole
 * number on the Rents page (2.5 rooms reads the 3-room rent); a neighborhood with no rent for that count falls back
 * to the city's average for it.
 */
export type RentTable = { hoods: { id: string; name: string; nameHe: string | null; city: string; lat: number; lng: number }[]; rents: Map<string, number> /* `${hoodId}:${rooms}` -> NIS */ };

let cache: { at: number; table: RentTable } | null = null;
export async function rentTable(): Promise<RentTable> {
  if (cache && Date.now() - cache.at < 60_000) return cache.table;
  const [hoods, rents] = await Promise.all([
    prisma.ilNeighborhood.findMany({ select: { id: true, name: true, nameHe: true, city: true, lat: true, lng: true } }),
    prisma.ilRent.findMany({ where: { rentNis: { not: null } }, select: { neighborhoodId: true, rooms: true, rentNis: true } }),
  ]);
  const table: RentTable = { hoods, rents: new Map(rents.map((r) => [`${r.neighborhoodId}:${r.rooms}`, r.rentNis!])) };
  cache = { at: Date.now(), table };
  return table;
}
export const forgetRentTable = () => {
  cache = null;
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/['’`"]/g, "").replace(/[^a-z0-9֐-׿]+/g, " ").trim();
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
export const roomsBucket = (rooms: number | null | undefined) => (rooms == null || !isFinite(rooms) ? null : Math.min(6, Math.max(1, Math.round(rooms)))); // 1 to 6 on The Rents (7 and 8 went on Oct 5, 2026); bigger homes read the 6-room rent

/** The neighborhood a unit belongs to: by pin, else by name. */
export function neighborhoodFor(table: RentTable, u: { city?: string | null; neighborhood?: string | null; lat?: number | null; lng?: number | null }) {
  const city = norm(u.city);
  // the neighborhood written on the ticket comes first when it is a known name (a pin near a border lands in the next neighborhood over)
  const named = norm(u.neighborhood);
  if (named) {
    const hit = table.hoods.find((h) => (norm(h.name) === named || norm(h.nameHe) === named) && (!city || norm(h.city) === city)) ?? table.hoods.find((h) => norm(h.name) === named || norm(h.nameHe) === named);
    if (hit) return hit;
  }
  if (u.lat != null && u.lng != null) {
    let best: RentTable["hoods"][number] | null = null, bestD = Infinity;
    for (const h of table.hoods) {
      const d = km({ lat: u.lat, lng: u.lng }, h) * (city && norm(h.city) !== city ? 1.5 : 1); // the same city wins a near tie
      if (d < bestD) { bestD = d; best = h; }
    }
    if (best && bestD <= 2.5) return best;
  }
  return null;
}

export type Expected = { rentNis: number | null; yieldPct: number | null; neighborhood: string | null; city: string | null; rooms: number | null; how: "neighborhood" | "city" | null };

/** Expected monthly rent and yield for a unit. */
export function expectedFor(table: RentTable, u: { city?: string | null; neighborhood?: string | null; lat?: number | null; lng?: number | null; rooms?: number | null; priceNis?: number | null }): Expected {
  const rooms = roomsBucket(u.rooms);
  const hood = neighborhoodFor(table, u);
  const none: Expected = { rentNis: null, yieldPct: null, neighborhood: hood?.name ?? null, city: hood?.city ?? u.city ?? null, rooms, how: null };
  if (!rooms) return none;
  let rent: number | null = null, how: Expected["how"] = null;
  if (hood) {
    const r = table.rents.get(`${hood.id}:${rooms}`);
    if (r) { rent = r; how = "neighborhood"; }
  }
  if (rent == null) {
    const city = norm(hood?.city ?? u.city);
    if (city) {
      const vals = table.hoods.filter((h) => norm(h.city) === city).map((h) => table.rents.get(`${h.id}:${rooms}`)).filter((v): v is number => Boolean(v));
      if (vals.length) { rent = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length); how = "city"; }
    }
  }
  if (rent == null) return none;
  const yieldPct = u.priceNis && u.priceNis > 0 ? Math.round(((rent * 12) / u.priceNis) * 10000) / 100 : null;
  return { rentNis: rent, yieldPct, neighborhood: hood?.name ?? null, city: hood?.city ?? u.city ?? null, rooms, how };
}

export { yieldColor } from "@/lib/il-yield";
