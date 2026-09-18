import { ensureAqGeo, type AqGeoRow } from "@/lib/aq-geocode";
import { recheckAqLocation } from "@/app/acquisitions/actions";

/** Location: the Google Maps pin for the property address, top right of the ticket, like RJL Israel's. The line under the map says what the address resolved to. */
export async function AqMapCard({ id, row }: { id: string; row: AqGeoRow }) {
  const { geo, query } = await ensureAqGeo(id, row);
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
        <div className="px-4 py-6 text-center text-sm text-muted">Fill in the address, city and state on the left and the map appears here.</div>
      ) : geo ? (
        <>
          <iframe title="Map" src={`https://maps.google.com/maps?q=${geo.lat},${geo.lng}&z=${geo.precision === "street" ? 17 : 13}&output=embed`} className="block h-56 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          <div className={`px-4 py-2 text-xs ${geo.precision === "street" ? "text-emerald-700" : "text-amber-700"}`}>
            {geo.precision === "street" ? "Address found: " : "Only the city was found; check the street: "}
            <span className="text-muted">{geo.label}</span>
          </div>
        </>
      ) : (
        <div className="px-4 py-4 text-sm text-amber-800">
          The address was not found on the map. Check the address, city and state on the left, then{" "}
          <form action={recheckAqLocation.bind(null, id)} className="inline">
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
