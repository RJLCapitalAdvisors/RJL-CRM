import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { usdIls } from "@/lib/fx";
import { feet, nis, parseJsonList, pricePerMeter, sqft, sqm, usdFmt, yearOf } from "@/lib/israel";
import { MAX_COMPARE } from "../compare-select";

export const metadata = { title: "Compare units" };
export const dynamic = "force-dynamic";

/**
 * Up to five apartments side by side. Asking price and price per meter sit on top, the specs Jonathan compares
 * run down each column in the same order, the floorplan sits at the bottom. The best value in a row is marked:
 * lowest price and price per meter, most space, highest ceiling, most parking.
 */
export default async function CompareUnitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ids = (typeof sp.ids === "string" ? sp.ids.split(",") : []).map((x) => x.trim()).filter(Boolean).slice(0, MAX_COMPARE);
  const [found, fx] = await Promise.all([ids.length ? prisma.ilApartment.findMany({ where: { id: { in: ids } }, include: { developer: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } } }) : Promise.resolve([]), usdIls()]);
  const apts = ids.map((id) => found.find((a) => a.id === id)).filter((a): a is (typeof found)[number] => Boolean(a));
  const usd = (v: number | null | undefined) => (v != null && fx ? usdFmt(v / fx.ilsPerUsd) : null);
  const ppm = (a: (typeof apts)[number]) => pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm);
  const best = (vals: (number | null)[], pick: "min" | "max") => {
    const nums = vals.filter((v): v is number => v != null);
    if (nums.length < 2) return null;
    return pick === "min" ? Math.min(...nums) : Math.max(...nums);
  };
  const bestPrice = best(apts.map((a) => a.priceNis), "min");
  const bestPpm = best(apts.map(ppm), "min");
  const bestInternal = best(apts.map((a) => a.internalSqm), "max");
  const bestMirpeset = best(apts.map((a) => a.mirpesetSqm), "max");
  const bestCeiling = best(apts.map((a) => a.ceilingCm), "max");
  const parkingCount = (s: string | null) => (s == null ? null : s === "None" ? 0 : Number(s[0]) || null);
  const bestParking = best(apts.map((a) => parkingCount(a.parkingSpots)), "max");
  const dash = <span className="text-muted">—</span>;
  const mark = (on: boolean) => (on ? "rounded bg-emerald-50 px-1 font-semibold text-emerald-900" : "");

  type Row = { label: string; cell: (a: (typeof apts)[number]) => React.ReactNode };
  const rows: Row[] = [
    { label: "Address", cell: (a) => a.street ?? dash },
    { label: "City", cell: (a) => a.city ?? dash },
    { label: "Neighborhood", cell: (a) => a.neighborhood ?? dash },
    { label: "Rooms", cell: (a) => a.rooms ?? dash },
    { label: "Built / delivery", cell: (a) => (a.completionDate ? <span>{a.completionDate}{yearOf(a.completionDate) && yearOf(a.completionDate)! > new Date().getFullYear() ? <span className="text-xs text-muted"> (new)</span> : null}</span> : dash) },
    { label: "Floor", cell: (a) => (a.floor != null ? a.floor : dash) },
    { label: "Building stories", cell: (a) => a.totalFloors ?? dash },
    { label: "Total building units", cell: (a) => a.buildingUnits ?? dash },
    { label: "Apartment direction", cell: (a) => parseJsonList(a.direction).join(", ") || dash },
    { label: "Mirpeset direction", cell: (a) => parseJsonList(a.mirpesetDirection).join(", ") || dash },
    { label: "Mamad", cell: (a) => (a.mamad ? "Yes" : "No") },
    { label: "Internal m²", cell: (a) => (a.internalSqm != null ? <span className={mark(a.internalSqm === bestInternal)}>{sqm(a.internalSqm)} <span className="text-xs text-muted">{sqft(a.internalSqm)}</span></span> : dash) },
    { label: "Mirpeset m²", cell: (a) => (a.mirpesetSqm != null ? <span className={mark(a.mirpesetSqm === bestMirpeset)}>{sqm(a.mirpesetSqm)} <span className="text-xs text-muted">{sqft(a.mirpesetSqm)}</span></span> : dash) },
    { label: "Ceiling height", cell: (a) => (a.ceilingCm != null ? <span className={mark(a.ceilingCm === bestCeiling)}>{a.ceilingCm} cm <span className="text-xs text-muted">{feet(a.ceilingCm)}</span></span> : dash) },
    { label: "Parking spots", cell: (a) => (a.parkingSpots ? <span className={mark(parkingCount(a.parkingSpots) === bestParking && bestParking !== 0)}>{a.parkingSpots}</span> : dash) },
    { label: "Machsan", cell: (a) => (a.machsanSqm || a.machsanLocation ? [a.machsanSqm ? sqm(a.machsanSqm) : null, a.machsanLocation].filter(Boolean).join(", ") : dash) },
    { label: "Seller type", cell: (a) => a.sellerType ?? dash },
    { label: "Developer", cell: (a) => (a.developer ? <Link href={`/israel/companies/${a.developer.id}`} className="hover:underline">{a.developer.name}</Link> : dash) },
    { label: "Project", cell: (a) => (a.project ? <Link href={`/israel/projects/${a.project.id}`} className="hover:underline">{a.project.name}</Link> : dash) },
  ];
  const cols = Math.max(apts.length, 1);

  return (
    <>
      <PageHeader
        title="Compare units"
        subtitle={apts.length ? `${apts.length} apartments side by side · best value in each row marked in green` : "Pick apartments on the list first."}
        actions={
          <Link href="/israel/apartments?compare=1" className="btn-secondary">
            Back to the list
          </Link>
        }
      />
      {apts.length === 0 ? (
        <div className="px-8 py-10 text-sm text-muted">
          Nothing to compare. Open <Link href="/israel/apartments?compare=1" className="text-sky-600 hover:underline">Apartments</Link>, click Compare units, tick up to {MAX_COMPARE} apartments and click Compare.
        </div>
      ) : (
        <div className="overflow-x-auto px-8 py-5">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))`, minWidth: `${cols * 240}px` }}>
            {apts.map((a) => (
              <div key={a.id} className="card flex flex-col">
                <div className="border-b border-line px-4 py-3">
                  <Link href={`/israel/apartments/${a.id}`} className="block truncate font-semibold hover:underline" title={a.name}>
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{[a.neighborhood, a.city].filter(Boolean).join(", ") || " "}</div>
                </div>
                <div className={`border-b border-line px-4 py-3 ${a.priceNis != null && a.priceNis === bestPrice ? "bg-emerald-50" : "bg-cream-50"}`}>
                  <div className="text-[10px] uppercase tracking-wide text-muted">Asking price</div>
                  <div className="text-2xl font-semibold tabular-nums">{a.priceNis != null ? nis(a.priceNis) : "—"}</div>
                  {usd(a.priceNis) && <div className="text-xs text-muted">{usd(a.priceNis)}</div>}
                  <div className="mt-2 text-[10px] uppercase tracking-wide text-muted">Price per meter</div>
                  <div className={`text-lg font-semibold tabular-nums ${ppm(a) != null && ppm(a) === bestPpm ? "text-emerald-900" : ""}`}>{ppm(a) != null ? nis(ppm(a)) : "—"}</div>
                  {usd(ppm(a)) && <div className="text-xs text-muted">{usd(ppm(a))} per m² · internal plus a third of the mirpeset</div>}
                </div>
                <dl className="divide-y divide-line text-sm">
                  {rows.map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-3 px-4 py-1.5">
                      <dt className="shrink-0 text-xs text-muted">{r.label}</dt>
                      <dd className="text-right">{r.cell(a)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto border-t border-line p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Floorplan</div>
                  {a.floorplanType ? (
                    a.floorplanType === "application/pdf" ? (
                      <iframe src={`/api/israel/apartments/${a.id}/floorplan?v=${a.updatedAt.getTime()}`} title={`${a.name} floorplan`} className="h-64 w-full rounded-md border border-line bg-white" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/israel/apartments/${a.id}/floorplan?v=${a.updatedAt.getTime()}`} alt={`${a.name} floorplan`} className="max-h-64 w-full rounded-md object-contain" />
                    )
                  ) : (
                    <div className="grid h-24 place-items-center rounded-md border border-dashed border-line text-xs text-muted">No floorplan on the ticket</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
