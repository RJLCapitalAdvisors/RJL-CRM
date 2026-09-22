import { PageHeader } from "@/components/ui";
import { loadAqMapPins } from "@/lib/aq-map";
import { AcqMap } from "./acq-map";

export const metadata = { title: "Map View" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Map View: every property pinned; narrow to a contact, a company or an operator, then search any address to see where it sits relative to them. */
export default async function AcqMapPage() {
  const { pins, unplaced } = await loadAqMapPins();
  return (
    <>
      <PageHeader title="Map View" subtitle={`${pins.length} pinned${unplaced ? ` · ${unplaced} without a map location yet` : ""} · filter by contact, company or operator, then search an address to compare`} />
      <div className="h-[calc(100vh-44px)]">
        <AcqMap pins={pins} googleKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? null} />
      </div>
    </>
  );
}
