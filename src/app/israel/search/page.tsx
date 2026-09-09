import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IL_APARTMENT_TYPES, IL_CITIES, IL_DIRECTIONS, IL_STAGES, apartmentLine, nisShort, parseJsonList, pricePerSqm, stageToneIl } from "@/lib/israel";

export const metadata = { title: "Apartment search" };
export const dynamic = "force-dynamic";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
const num = (v: string | string[] | undefined) => {
  const x = Number(str(v));
  return str(v) && !isNaN(x) ? x : null;
};

/** Apartment search: filters over the apartments themselves (city, rooms, size, price, direction, parking, age). */
export default async function ApartmentSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = { city: str(sp.city), type: str(sp.type), rooms: num(sp.rooms), roomsMax: num(sp.roomsMax), sqmMin: num(sp.sqmMin), sqmMax: num(sp.sqmMax), priceMin: num(sp.priceMin), priceMax: num(sp.priceMax), direction: str(sp.direction), parking: num(sp.parking), builtAfter: num(sp.builtAfter), mirpeset: str(sp.mirpeset) === "1", stage: str(sp.stage), q: str(sp.q) };
  const all = await prisma.ilApartment.findMany({ orderBy: { updatedAt: "desc" }, include: { developer: { select: { name: true } } } });
  const rows = all.filter((a) => {
    if (f.stage && a.stage !== f.stage) return false;
    if (!f.stage && (a.stage === "Closed" || a.stage === "Lost")) return false;
    if (f.city && (a.city ?? "").toLowerCase() !== f.city.toLowerCase()) return false;
    if (f.type && a.apartmentType !== f.type) return false;
    if (f.rooms != null && (a.rooms ?? 0) < f.rooms) return false;
    if (f.roomsMax != null && (a.rooms ?? 0) > f.roomsMax) return false;
    if (f.sqmMin != null && (a.internalSqm ?? 0) < f.sqmMin) return false;
    if (f.sqmMax != null && (a.internalSqm ?? Infinity) > f.sqmMax) return false;
    if (f.priceMin != null && (a.priceNis ?? 0) < f.priceMin) return false;
    if (f.priceMax != null && (a.priceNis ?? Infinity) > f.priceMax) return false;
    if (f.direction && !parseJsonList(a.direction).includes(f.direction)) return false;
    if (f.parking != null && (a.parking ?? 0) < f.parking) return false;
    if (f.builtAfter != null && (a.builtYear ?? 9999) < f.builtAfter) return false;
    if (f.mirpeset && !(a.mirpesetSqm && a.mirpesetSqm > 0)) return false;
    if (f.q) {
      const hay = `${a.name} ${a.street ?? ""} ${a.neighborhood ?? ""} ${a.projectName ?? ""} ${a.developer?.name ?? ""} ${a.description ?? ""}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
  return (
    <>
      <PageHeader compact title="Apartment search" subtitle={`${rows.length} of ${all.length} apartments match`} />
      <div className="grid gap-4 px-6 py-5 lg:grid-cols-[300px_1fr]">
        <form method="get" className="card space-y-3 p-4 text-sm">
          <input name="q" defaultValue={f.q} placeholder="Search name, street, project, developer" className="input" />
          <select name="city" defaultValue={f.city} className="input">
            <option value="">Any city</option>
            {IL_CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select name="type" defaultValue={f.type} className="input">
            <option value="">Any type</option>
            {IL_APARTMENT_TYPES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input name="rooms" type="number" step="0.5" defaultValue={f.rooms ?? ""} placeholder="Rooms from" className="input" />
            <input name="roomsMax" type="number" step="0.5" defaultValue={f.roomsMax ?? ""} placeholder="to" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="sqmMin" type="number" defaultValue={f.sqmMin ?? ""} placeholder="Internal m² from" className="input" />
            <input name="sqmMax" type="number" defaultValue={f.sqmMax ?? ""} placeholder="to" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="priceMin" type="number" step="10000" defaultValue={f.priceMin ?? ""} placeholder="₪ from" className="input" />
            <input name="priceMax" type="number" step="10000" defaultValue={f.priceMax ?? ""} placeholder="₪ to" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select name="direction" defaultValue={f.direction} className="input">
              <option value="">Any direction</option>
              {IL_DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
            <input name="parking" type="number" defaultValue={f.parking ?? ""} placeholder="Parking ≥" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="builtAfter" type="number" defaultValue={f.builtAfter ?? ""} placeholder="Built after (year)" className="input" />
            <select name="stage" defaultValue={f.stage} className="input">
              <option value="">In play</option>
              {IL_STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="mirpeset" value="1" defaultChecked={f.mirpeset} className="accent-ink" /> Has a mirpeset
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">
              Search
            </button>
            <Link href="/israel/search" className="btn-secondary">
              Clear
            </Link>
          </div>
        </form>
        <div className="card overflow-hidden">
          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th>Apartment</th>
                <th>City</th>
                <th className="text-right">Rooms</th>
                <th className="text-right">Internal</th>
                <th className="text-right">Mirpeset</th>
                <th>Direction</th>
                <th className="text-right">Parking</th>
                <th className="text-right">Price</th>
                <th className="text-right">₪/m²</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/israel/apartments/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <div className="text-xs text-muted">{apartmentLine({ ...a, city: null, neighborhood: a.neighborhood })}</div>
                  </td>
                  <td>{a.city}</td>
                  <td className="text-right">{a.rooms ?? ""}</td>
                  <td className="text-right">{a.internalSqm ?? ""}</td>
                  <td className="text-right">{a.mirpesetSqm ?? ""}</td>
                  <td>{parseJsonList(a.direction).map((d) => d[0]).join("")}</td>
                  <td className="text-right">{a.parking ?? ""}</td>
                  <td className="text-right">{nisShort(a.priceNis)}</td>
                  <td className="text-right">{pricePerSqm(a.priceNis, a.internalSqm)?.toLocaleString("en-US") ?? ""}</td>
                  <td>
                    <span className={`chip text-[11px] ${stageToneIl[a.stage] ?? ""}`}>{a.stage}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    No apartments match. Loosen a filter, or add apartments first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
