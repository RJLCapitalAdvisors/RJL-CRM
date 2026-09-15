import { ensureGeo, type GeoRow, type IlKind } from "@/lib/geocode";
import { recheckIlLocation } from "@/app/israel/actions";

/**
 * Where it is: a Google Maps pin for the address on the ticket, under Seller on the right. The address is checked
 * first (looked up once per address); the line under the map says what it resolved to and how precisely, so a
 * street that could not be found is caught before the unit goes out. Check again after fixing the address.
 */
export async function IlMapCard({ kind, id, row }: { kind: IlKind; id: string; row: GeoRow }) {
  const { geo, query } = await ensureGeo(kind, id, row);
  const search = query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">Location</div>
        {search && (
          <a href={search} target="_blank" className="text-xs text-sky-700 hover:underline">
            Open in Google Maps
          </a>
        )}
      </div>
      {!query ? (
        <div className="px-4 py-6 text-center text-sm text-muted">Fill in the address and city on the left and the map appears here.</div>
      ) : geo ? (
        <>
          <iframe title="Map" src={`https://maps.google.com/maps?q=${geo.lat},${geo.lng}&z=${geo.precision === "street" ? 17 : geo.precision === "area" ? 15 : 13}&output=embed`} className="block h-56 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          <div className={`px-4 py-2 text-xs ${geo.precision === "street" ? "text-emerald-700" : "text-amber-700"}`}>
            {geo.precision === "street" ? "Address found: " : geo.precision === "area" ? "Street not found; pinned to the neighborhood: " : "Only the city was found; check the street: "}
            <span className="text-muted">{geo.label}</span>
          </div>
        </>
      ) : (
        <div className="px-4 py-4 text-sm text-amber-800">
          The address was not found on the map. Check the street and city on the left, then{" "}
          <form action={recheckIlLocation.bind(null, kind, id)} className="inline">
            <button type="submit" className="underline">
              check again
            </button>
          </form>
          .
        </div>
      )}
    </div>
  );
}
