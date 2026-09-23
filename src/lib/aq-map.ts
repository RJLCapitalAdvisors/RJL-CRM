import { prisma } from "@/lib/db";
import { ensureAqGeo, aqAddressQuery } from "@/lib/aq-geocode";
import { aqFullName } from "@/lib/acquisitions";

/**
 * Map View for RJL Acquisitions (Sep 22, 2026): every property as a pin, with the people and companies around it so
 * the map can be narrowed to one contact, one company or one operator. Unplaced addresses are looked up a few per
 * page load (Nominatim allows one lookup a second).
 */
export type AqMapPin = { id: string; address: string; city: string | null; state: string | null; lat: number; lng: number; businessName: string | null; ownerEntity: string | null; ownerName: string | null; operatorEntity: string | null; operatorName: string | null; primaryPhone: string | null; callResult: string | null; contacts: { id: string; name: string }[]; companies: { id: string; name: string }[]; href: string };

const LOOKUPS_PER_LOAD = 8;

export async function loadAqMapPins(): Promise<{ pins: AqMapPin[]; unplaced: number }> {
  const rows = await prisma.aqProperty.findMany({
    where: { junkedAt: null },
    include: { contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } }, companies: { include: { company: { select: { id: true, name: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
  let budget = LOOKUPS_PER_LOAD;
  let unplaced = 0;
  const pins: AqMapPin[] = [];
  for (const p of rows) {
    let lat = p.lat, lng = p.lng;
    const wants = aqAddressQuery(p) !== p.geoQuery;
    if ((lat == null || wants) && budget > 0 && aqAddressQuery(p)) {
      budget--;
      const { geo } = await ensureAqGeo(p.id, p);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }
    if (lat == null || lng == null) {
      unplaced++;
      continue;
    }
    let stages: string[] = [];
    try {
      stages = JSON.parse(p.stages) as string[];
    } catch {
      stages = [];
    }
    pins.push({ id: p.id, address: p.address, city: p.city, state: p.state, lat, lng, businessName: p.businessName, ownerEntity: p.ownerEntity, ownerName: p.ownerName, operatorEntity: p.operatorEntity, operatorName: p.operatorName, primaryPhone: p.primaryPhone, callResult: stages[0] ?? null, contacts: p.contacts.map((x) => ({ id: x.contact.id, name: aqFullName(x.contact) })), companies: p.companies.map((x) => ({ id: x.company.id, name: x.company.name })), href: `/acquisitions/properties/${p.id}` });
  }
  return { pins, unplaced };
}
