import { NextResponse } from "next/server";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export type AddressSuggestion = { label: string; street: string; city: string | null; neighborhood: string | null; lat: number; lng: number; exact: boolean };

/**
 * Address suggestions for the Israel forms (Jonathan, Sep 23, 2026): as the street is typed, the same OpenStreetMap
 * geocoder the map pins use offers matching addresses, so what is picked is sure to map. Only results with a house
 * number are marked exact; the picker shows the rest greyed as "street only". Swap in Google Places when a key arrives.
 */
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json([], { status: 401 });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const city = (url.searchParams.get("city") ?? "").trim();
  if (q.length < 3) return NextResponse.json([]);
  const query = city && !q.toLowerCase().includes(city.toLowerCase()) ? `${q}, ${city}` : q;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=il&accept-language=en&addressdetails=1&q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "RJL CRM (jonathan@rjlcapadvisors.com)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return NextResponse.json([]);
    type Hit = { lat: string; lon: string; display_name: string; address?: Record<string, string> };
    const hits = (await res.json()) as Hit[];
    const out: AddressSuggestion[] = [];
    for (const h of hits) {
      const a = h.address ?? {};
      const road = a.road ?? a.pedestrian ?? a.residential ?? a.footway ?? null;
      if (!road) continue;
      const number = a.house_number ?? null;
      const town = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
      const hood = a.suburb ?? a.neighbourhood ?? a.quarter ?? null;
      const street = number ? `${road} ${number}` : road;
      const label = [street, hood, town].filter(Boolean).join(", ");
      if (out.some((o) => o.label === label)) continue;
      out.push({ label, street, city: town, neighborhood: hood, lat: Number(h.lat), lng: Number(h.lon), exact: Boolean(number) });
    }
    return NextResponse.json(out.slice(0, 6));
  } catch {
    return NextResponse.json([]);
  }
}
