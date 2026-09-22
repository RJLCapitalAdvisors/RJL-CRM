import { PageHeader } from "@/components/ui";
import { loadMapUnits } from "@/lib/il-map";
import { IsraelMap } from "./israel-map";

export const metadata = { title: "Map View" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Map View: all of Israel, every apartment, house and project pinned where it stands, for comp research. */
export default async function IsraelMapPage() {
  const { units, unplaced } = await loadMapUnits();
  return (
    <>
      <PageHeader title="Map View" subtitle={`${units.length} pinned${unplaced ? ` · ${unplaced} without a map location yet (address unclear or still being looked up)` : ""} · hover a pin for the units there, circle an area or pick units to compare`} />
      <div className="h-[calc(100vh-44px)]">
        <IsraelMap units={units} />
      </div>
    </>
  );
}
