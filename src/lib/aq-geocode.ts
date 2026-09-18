import { prisma } from "@/lib/db";
import type { Geo } from "@/lib/geocode";

/**
 * The map pin on an Acquisitions property ticket (the Location window on the right, like RJL Israel's). The address,
 * city and state are looked up once (OpenStreetMap's Nominatim, United States) and kept on the row with the query
 * they resolved from, so a changed address is looked up again and an unchanged one never is.
 */
export type AqGeoRow = { address: string | null; city: string | null; state: string | null; lat: number | null; lng: number | null; geoQuery: string | null; geoLabel: string | null };

export const aqAddressQuery = (r: { address: string | null; city: string | null; state: string | null }) => (r.address || r.city ? [r.address, r.city, r.state, "USA"].filter(Boolean).join(", ") : null);

async function lookup(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&accept-language=en&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": "RJL CRM (jonathan@rjlcapadvisors.com)" }, cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = j[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
}

async function geocode(r: { address: string | null; city: string | null; state: string | null }): Promise<Geo | null> {
  const tries: { q: string; precision: Geo["precision"] }[] = [];
  if (r.address) tries.push({ q: [r.address, r.city, r.state, "USA"].filter(Boolean).join(", "), precision: "street" });
  if (r.city) tries.push({ q: [r.city, r.state, "USA"].filter(Boolean).join(", "), precision: "city" });
  for (const t of tries) {
    const hit = await lookup(t.q).catch(() => null);
    if (hit) return { ...hit, precision: t.precision };
    await new Promise((res) => setTimeout(res, 1100)); // Nominatim asks for one request a second
  }
  return null;
}

export async function ensureAqGeo(id: string, row: AqGeoRow): Promise<{ geo: Geo | null; query: string | null }> {
  const query = aqAddressQuery(row);
  if (!query) return { geo: null, query: null };
  if (row.geoQuery === query) {
    const precision = (row.geoLabel?.split(" | ")[1] as Geo["precision"] | undefined) ?? "street";
    return { geo: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng, label: row.geoLabel?.split(" | ")[0] ?? query, precision } : null, query };
  }
  const geo = await geocode(row);
  await prisma.aqProperty.update({ where: { id }, data: { geoQuery: query, lat: geo?.lat ?? null, lng: geo?.lng ?? null, geoLabel: geo ? `${geo.label} | ${geo.precision}` : null } }).catch(() => null);
  return { geo, query };
}

export async function forgetAqGeo(id: string) {
  await prisma.aqProperty.update({ where: { id }, data: { geoQuery: null } }).catch(() => null);
}
