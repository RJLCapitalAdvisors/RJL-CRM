import { prisma } from "@/lib/db";

/**
 * Where a unit or project is, as a pin. The address fields are looked up once per address (OpenStreetMap's
 * Nominatim, Israel only) and the result is kept on the row: lat, lng, the place it resolved to, and the query it
 * was resolved from, so a changed address is looked up again and an unchanged one never is. The map card shows
 * the pin and says how precise the match was (street, area or only the city), so a bad address is caught before
 * the unit goes out to anyone.
 */
export type Geo = { lat: number; lng: number; label: string; precision: "street" | "area" | "city" };
export type GeoRow = { street: string | null; neighborhood: string | null; city: string | null; lat: number | null; lng: number | null; geoQuery: string | null; geoLabel: string | null };
export type IlKind = "apartments" | "houses" | "projects";

export function addressQuery(row: { street: string | null; neighborhood: string | null; city: string | null }): string | null {
  if (!row.street && !row.city) return null;
  return [row.street, row.neighborhood, row.city, "Israel"].filter(Boolean).join(", ");
}

async function lookup(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il&accept-language=en&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": "RJL CRM (jonathan@rjlcapadvisors.com)" }, cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = j[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}

/** Street and city first; the neighborhood when the street is unknown; the city alone as a last resort. */
export async function geocode(row: { street: string | null; neighborhood: string | null; city: string | null }): Promise<Geo | null> {
  const tries: { q: string; precision: Geo["precision"] }[] = [];
  if (row.street && row.city) tries.push({ q: `${row.street}, ${row.city}, Israel`, precision: "street" });
  if (row.neighborhood && row.city) tries.push({ q: `${row.neighborhood}, ${row.city}, Israel`, precision: "area" });
  if (row.city) tries.push({ q: `${row.city}, Israel`, precision: "city" });
  if (row.street && !row.city) tries.push({ q: `${row.street}, Israel`, precision: "street" });
  for (const t of tries) {
    const hit = await lookup(t.q).catch(() => null);
    if (hit) return { ...hit, precision: t.precision };
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim asks for one request a second
  }
  return null;
}

const table = (kind: IlKind) => (kind === "apartments" ? prisma.ilApartment : kind === "houses" ? prisma.ilHouse : prisma.ilProject);

/** The pin for a row, looked up now if the address changed since the last time. */
export async function ensureGeo(kind: IlKind, id: string, row: GeoRow): Promise<{ geo: Geo | null; query: string | null }> {
  const query = addressQuery(row);
  if (!query) return { geo: null, query: null };
  if (row.geoQuery === query) {
    const precision = (row.geoLabel?.split(" | ")[1] as Geo["precision"] | undefined) ?? "street";
    return { geo: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng, label: row.geoLabel?.split(" | ")[0] ?? query, precision } : null, query };
  }
  const geo = await geocode(row);
  const data = { geoQuery: query, lat: geo?.lat ?? null, lng: geo?.lng ?? null, geoLabel: geo ? `${geo.label} | ${geo.precision}` : null };
  await (table(kind) as unknown as { update: (a: { where: { id: string }; data: typeof data }) => Promise<unknown> }).update({ where: { id }, data }).catch(() => null);
  return { geo, query };
}

/** Forget the pin so the next page load looks the address up again. */
export async function forgetGeo(kind: IlKind, id: string) {
  await (table(kind) as unknown as { update: (a: { where: { id: string }; data: { geoQuery: null } }) => Promise<unknown> }).update({ where: { id }, data: { geoQuery: null } }).catch(() => null);
}
