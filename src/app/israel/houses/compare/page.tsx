import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { usdIls } from "@/lib/fx";
import { ACRES_PER_SQM, feet, nis, parseJsonList, parseMirpasot, pricePerMeter, sqft, sqm, usdFmt, yearOf } from "@/lib/israel";
import { MAX_COMPARE } from "../../apartments/compare-select";

export const metadata = { title: "Compare houses" };
export const dynamic = "force-dynamic";

/**
 * Up to five houses side by side, the same way apartments compare: asking price and price per meter on top, the
 * specs down each column in the same order, the floorplan at the bottom. Best value in a row marked in green:
 * lowest price and price per meter, most space, biggest migrash, highest ceiling, most parking.
 */
export default async function CompareHousesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ids = (typeof sp.ids === "string" ? sp.ids.split(",") : []).map((x) => x.trim()).filter(Boolean).slice(0, MAX_COMPARE);
  const [found, fx] = await Promise.all([ids.length ? prisma.ilHouse.findMany({ where: { id: { in: ids } }, include: { developer: { select: { id: true, name: true } } } }) : Promise.resolve([]), usdIls()]);
  const houses = ids.map((id) => found.find((h) => h.id === id)).filter((h): h is (typeof found)[number] => Boolean(h));
  const usd = (v: number | null | undefined) => (v != null && fx ? usdFmt(v / fx.ilsPerUsd) : null);
  const ppm = (h: (typeof houses)[number]) => pricePerMeter(h.priceNis, h.internalSqm, h.mirpesetSqm);
  const ceilings = (h: (typeof houses)[number]) => parseJsonList(h.ceilingCms).map((x) => (x === "" ? null : Number(x)));
  const topCeiling = (h: (typeof houses)[number]) => {
    const c = ceilings(h).filter((x): x is number => x != null && !isNaN(x));
    return c.length ? Math.max(...c) : null;
  };
  const best = (vals: (number | null)[], pick: "min" | "max") => {
    const nums = vals.filter((v): v is number => v != null);
    if (nums.length < 2) return null;
    return pick === "min" ? Math.min(...nums) : Math.max(...nums);
  };
  const bestPrice = best(houses.map((h) => h.priceNis), "min");
  const bestPpm = best(houses.map(ppm), "min");
  const bestInternal = best(houses.map((h) => h.internalSqm), "max");
  const bestMirpeset = best(houses.map((h) => h.mirpesetSqm), "max");
  const bestMigrash = best(houses.map((h) => h.migrashSqm), "max");
  const bestCeiling = best(houses.map(topCeiling), "max");
  const parkingCount = (s: string | null) => (s == null ? null : s === "None" ? 0 : Number(s[0]) || null);
  const bestParking = best(houses.map((h) => parkingCount(h.parkingSpots)), "max");
  const dash = <span className="text-muted">—</span>;
  const mark = (on: boolean) => (on ? "rounded bg-emerald-50 px-1 font-semibold text-emerald-900" : "");
  const FLOOR = ["Ground", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

  type Row = { label: string; cell: (h: (typeof houses)[number]) => React.ReactNode };
  const rows: Row[] = [
    { label: "House type", cell: (h) => h.houseType ?? dash },
    { label: "Address", cell: (h) => h.street ?? dash },
    { label: "City", cell: (h) => h.city ?? dash },
    { label: "Neighborhood", cell: (h) => h.neighborhood ?? dash },
    { label: "Rooms", cell: (h) => h.rooms ?? dash },
    { label: "Built / delivery", cell: (h) => (h.completionDate ? <span>{h.completionDate}{yearOf(h.completionDate) && yearOf(h.completionDate)! > new Date().getFullYear() ? <span className="text-xs text-muted"> (new)</span> : null}</span> : dash) },
    { label: "Floors", cell: (h) => h.floors ?? dash },
    {
      label: "Ceilings",
      cell: (h) => {
        const c = ceilings(h);
        if (!c.some((x) => x != null)) return dash;
        return (
          <span className="block text-right">
            {c.map((x, k) =>
              x == null ? null : (
                <span key={k} className={`block ${mark(x === bestCeiling)}`}>
                  {FLOOR[k] ?? `Floor ${k + 1}`}: {x} cm <span className="text-xs text-muted">{feet(x)}</span>
                </span>
              ),
            )}
          </span>
        );
      },
    },
    {
      label: "Mirpasot",
      cell: (h) => {
        const list = parseMirpasot(h.mirpasot);
        if (list.length > 1) return <span className="block text-right">{list.map((m, k) => <span key={k} className="block">{k + 1}: {m.sqm != null ? sqm(m.sqm) : "—"}{m.direction.length ? ` ${m.direction.join("/")}` : ""}{m.sukka ? ` · sukka ${m.sukka.toLowerCase()}` : ""}</span>)}</span>;
        return h.mirpesetCount ?? (h.mirpesetSqm ? 1 : dash);
      },
    },
    { label: "Mirpeset direction", cell: (h) => parseJsonList(h.mirpesetDirection).join(", ") || dash },
    { label: "Sukka", cell: (h) => { const list = parseMirpasot(h.mirpasot); const v = list.length === 1 ? list[0].sukka : list.length > 1 ? (list.every((m) => m.sukka === "No") ? "No" : list.some((m) => m.sukka === "Yes") ? "Yes" : list.some((m) => m.sukka) ? "Partial" : null) : null; return v ?? dash; } },
    { label: "Pool", cell: (h) => (h.pool === "Yes" ? (h.poolSqm ? `Yes, ${sqm(h.poolSqm)}` : "Yes") : h.pool === "No" ? "No" : dash) },
    { label: "Mamad", cell: (h) => (h.mamad == null ? "" : h.mamad ? "Yes" : "No") },
    { label: "Internal m²", cell: (h) => (h.internalSqm != null ? <span className={mark(h.internalSqm === bestInternal)}>{sqm(h.internalSqm)} <span className="text-xs text-muted">{sqft(h.internalSqm)}</span></span> : dash) },
    { label: "Mirpeset m²", cell: (h) => (h.mirpesetSqm != null ? <span className={mark(h.mirpesetSqm === bestMirpeset)}>{sqm(h.mirpesetSqm)} <span className="text-xs text-muted">{sqft(h.mirpesetSqm)}</span></span> : dash) },
    {
      label: "Migrash",
      cell: (h) =>
        h.migrashSqm != null ? (
          <span className={mark(h.migrashSqm === bestMigrash)}>
            {sqm(h.migrashSqm)} <span className="text-xs text-muted">{(h.migrashSqm / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} dunam · {(h.migrashSqm * ACRES_PER_SQM).toLocaleString("en-US", { maximumFractionDigits: 3 })} acres</span>
          </span>
        ) : (
          dash
        ),
    },
    { label: "Parking", cell: (h) => (h.parkingSpots ? <span className={mark(parkingCount(h.parkingSpots) === bestParking && bestParking !== 0)}>{h.parkingSpots}</span> : dash) },
    { label: "Seller type", cell: (h) => h.sellerType ?? dash },
    { label: "Developer", cell: (h) => (h.developer ? <Link href={`/israel/companies/${h.developer.id}`} className="hover:underline">{h.developer.name}</Link> : dash) },
  ];
  const cols = Math.max(houses.length, 1);

  return (
    <>
      <PageHeader
        title="Compare houses"
        subtitle={houses.length ? `${houses.length} houses side by side · best value in each row marked in green` : "Pick houses on the list first."}
        actions={
          <Link href="/israel/houses?compare=1" className="btn-secondary">
            Back to the list
          </Link>
        }
      />
      {houses.length === 0 ? (
        <div className="px-8 py-10 text-sm text-muted">
          Nothing to compare. Open <Link href="/israel/houses?compare=1" className="text-sky-600 hover:underline">Houses</Link>, click Compare houses, tick up to {MAX_COMPARE} and click Compare.
        </div>
      ) : (
        <div className="overflow-x-auto px-8 py-5">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))`, minWidth: `${cols * 240}px` }}>
            {houses.map((h) => (
              <div key={h.id} className="card flex flex-col">
                <div className="border-b border-line px-4 py-3">
                  <Link href={`/israel/houses/${h.id}`} className="block truncate font-semibold hover:underline" title={h.name}>
                    {h.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{[h.neighborhood, h.city].filter(Boolean).join(", ") || " "}</div>
                </div>
                <div className={`border-b border-line px-4 py-3 ${h.priceNis != null && h.priceNis === bestPrice ? "bg-emerald-50" : "bg-cream-50"}`}>
                  <div className="text-[10px] uppercase tracking-wide text-muted">Asking price</div>
                  <div className="text-2xl font-semibold tabular-nums">{h.priceNis != null ? nis(h.priceNis) : "—"}</div>
                  {usd(h.priceNis) && <div className="text-xs text-muted">{usd(h.priceNis)}</div>}
                  <div className="mt-2 text-[10px] uppercase tracking-wide text-muted">Price per meter</div>
                  <div className={`text-lg font-semibold tabular-nums ${ppm(h) != null && ppm(h) === bestPpm ? "text-emerald-900" : ""}`}>{ppm(h) != null ? nis(ppm(h)) : "—"}</div>
                  {usd(ppm(h)) && <div className="text-xs text-muted">{usd(ppm(h))} per m² · internal plus a third of the mirpeset</div>}
                </div>
                <dl className="divide-y divide-line text-sm">
                  {rows.map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-3 px-4 py-1.5">
                      <dt className="shrink-0 text-xs text-muted">{r.label}</dt>
                      <dd className="text-right">{r.cell(h)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto border-t border-line p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Floorplan</div>
                  {h.floorplanType ? (
                    h.floorplanType === "application/pdf" ? (
                      <iframe src={`/api/israel/houses/${h.id}/floorplan?v=${h.updatedAt.getTime()}`} title={`${h.name} floorplan`} className="h-64 w-full rounded-md border border-line bg-white" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/israel/houses/${h.id}/floorplan?v=${h.updatedAt.getTime()}`} alt={`${h.name} floorplan`} className="max-h-64 w-full rounded-md object-contain" />
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
