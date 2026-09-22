import { prisma } from "@/lib/db";
import { ensureGeo } from "@/lib/geocode";
import { pricePerMeter } from "@/lib/israel";

/**
 * Map View (Sep 22, 2026): every apartment, house and project in RJL Israel as a pin. Units whose address has not
 * been looked up yet are geocoded on the way in, a few per page load (Nominatim allows one lookup a second), so a
 * fresh unit appears on the map within a visit or two.
 */
export type MapUnit = { id: string; kind: "apartments" | "houses" | "projects"; name: string; lat: number; lng: number; city: string | null; neighborhood: string | null; street: string | null; rooms: number | null; internalSqm: number | null; mirpesetSqm: number | null; priceNis: number | null; ppm: number | null; projectName: string | null; precision: string; href: string };

const LOOKUPS_PER_LOAD = 8;

export async function loadMapUnits(): Promise<{ units: MapUnit[]; unplaced: number }> {
  const [apts, houses, projects] = await Promise.all([
    prisma.ilApartment.findMany({ where: { pendingApproval: false }, select: { id: true, name: true, street: true, neighborhood: true, city: true, lat: true, lng: true, geoQuery: true, geoLabel: true, rooms: true, internalSqm: true, mirpesetSqm: true, priceNis: true, project: { select: { name: true } } } }),
    prisma.ilHouse.findMany({ where: { pendingApproval: false }, select: { id: true, name: true, street: true, neighborhood: true, city: true, lat: true, lng: true, geoQuery: true, geoLabel: true, rooms: true, internalSqm: true, mirpesetSqm: true, priceNis: true } }),
    prisma.ilProject.findMany({ where: { pendingApproval: false }, select: { id: true, name: true, street: true, neighborhood: true, city: true, lat: true, lng: true, geoQuery: true, geoLabel: true } }),
  ]);
  let budget = LOOKUPS_PER_LOAD;
  let unplaced = 0;
  const units: MapUnit[] = [];
  const place = async (kind: MapUnit["kind"], r: { id: string; name: string; street: string | null; neighborhood: string | null; city: string | null; lat: number | null; lng: number | null; geoQuery: string | null; geoLabel: string | null }, extra: Partial<MapUnit>) => {
    let lat = r.lat, lng = r.lng, precision = r.geoLabel?.split(" | ")[1] ?? "street";
    const wantsLookup = !r.street && !r.city ? false : r.geoQuery !== [r.street, r.neighborhood, r.city, "Israel"].filter(Boolean).join(", ");
    if ((lat == null || wantsLookup) && budget > 0) {
      budget--;
      const { geo } = await ensureGeo(kind, r.id, r);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        precision = geo.precision;
      }
    }
    if (lat == null || lng == null) {
      unplaced++;
      return;
    }
    units.push({ id: r.id, kind, name: r.name, lat, lng, city: r.city, neighborhood: r.neighborhood, street: r.street, rooms: null, internalSqm: null, mirpesetSqm: null, priceNis: null, ppm: null, projectName: null, precision, href: `/israel/${kind}/${r.id}`, ...extra });
  };
  for (const a of apts) await place("apartments", a, { rooms: a.rooms, internalSqm: a.internalSqm, mirpesetSqm: a.mirpesetSqm, priceNis: a.priceNis, ppm: pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm), projectName: a.project?.name ?? null });
  for (const h of houses) await place("houses", h, { rooms: h.rooms, internalSqm: h.internalSqm, mirpesetSqm: h.mirpesetSqm, priceNis: h.priceNis, ppm: pricePerMeter(h.priceNis, h.internalSqm, h.mirpesetSqm) });
  for (const p of projects) await place("projects", p, {});
  return { units, unplaced };
}
