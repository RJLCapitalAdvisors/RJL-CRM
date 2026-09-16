"use client";

import { RangeSlider } from "@/components/range-slider";
import { MultiSelect } from "@/components/multi-select";
import type { Stop } from "@/lib/ranges";
import { YEAR_STOPS } from "@/app/israel/apartments/filters";

export type ProjectFilters = {
  q: string;
  cities: string[];
  neighborhoods: string[];
  developers: string[];
  unitsMin: number | null;
  unitsMax: number | null;
  storiesMin: number | null;
  storiesMax: number | null;
  parkingMin: number | null;
  parkingMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  pool: string;
  brochure: string;
  listed: string;
  sort: string;
};

export const UNITS_STOPS: Stop[] = Array.from({ length: 500 / 10 + 1 }, (_, i) => ({ value: i * 10, label: i * 10 >= 500 ? "500+" : String(i * 10) }));
export const STORIES_STOPS: Stop[] = Array.from({ length: 50 }, (_, i) => ({ value: i + 1, label: i + 1 >= 50 ? "50+" : String(i + 1) }));
export const PARKING_STOPS: Stop[] = Array.from({ length: 600 / 20 + 1 }, (_, i) => ({ value: i * 20, label: i * 20 >= 600 ? "600+" : String(i * 20) }));

export const SORTS: { value: string; label: string }[] = [
  { value: "updated", label: "Recently touched" },
  { value: "units-desc", label: "Units, most first" },
  { value: "units-asc", label: "Units, fewest first" },
  { value: "delivery-asc", label: "Delivery, soonest first" },
  { value: "delivery-desc", label: "Delivery, latest first" },
  { value: "listed-desc", label: "Most apartments listed" },
  { value: "name", label: "Name" },
];

/** The projects filter rail, the same shape as apartments and houses: text search, pick-lists, ranges as sliders, a sort. A plain GET form, so a filtered list has a shareable URL. */
export function ProjectFiltersRail({ f, cities, neighborhoods, developers, total }: { f: ProjectFilters; cities: string[]; neighborhoods: string[]; developers: string[]; total: number }) {
  return (
    <form method="get" action="/israel/projects" className="card flex max-h-[calc(100vh-140px)] flex-col text-sm xl:sticky xl:top-4">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="font-semibold">Filters</div>
        <a href="/israel/projects" className="text-xs text-muted hover:underline">
          Clear all
        </a>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <input name="q" defaultValue={f.q} placeholder="Search name, address, neighborhood, developer" className="input" />
        <div>
          <div className="label">City</div>
          <MultiSelect name="city" options={cities} selected={f.cities} placeholder="Any city" />
        </div>
        <div>
          <div className="label">Neighborhood</div>
          <MultiSelect name="neighborhood" options={neighborhoods} selected={f.neighborhoods} placeholder="Any neighborhood" />
        </div>
        <div>
          <div className="label">Developer</div>
          <MultiSelect name="developer" options={developers} selected={f.developers} placeholder="Any developer" />
        </div>
        <div>
          <div className="label">Units in the project</div>
          <RangeSlider name="units" stops={UNITS_STOPS} min={f.unitsMin} max={f.unitsMax} />
        </div>
        <div>
          <div className="label">Stories</div>
          <RangeSlider name="stories" stops={STORIES_STOPS} min={f.storiesMin} max={f.storiesMax} />
        </div>
        <div>
          <div className="label">Parking spaces</div>
          <RangeSlider name="parking" stops={PARKING_STOPS} min={f.parkingMin} max={f.parkingMax} />
        </div>
        <div>
          <div className="label">Built or expected delivery</div>
          <RangeSlider name="year" stops={YEAR_STOPS} min={f.yearMin} max={f.yearMax} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="label">Pool</div>
            <select name="pool" defaultValue={f.pool} className="input">
              <option value="">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <div className="label">Brochure</div>
            <select name="brochure" defaultValue={f.brochure} className="input">
              <option value="">Any</option>
              <option value="yes">On file</option>
              <option value="no">Missing</option>
            </select>
          </div>
          <div>
            <div className="label">Units listed</div>
            <select name="listed" defaultValue={f.listed} className="input">
              <option value="">Any</option>
              <option value="yes">Has some</option>
              <option value="no">None yet</option>
            </select>
          </div>
        </div>
        <div>
          <div className="label">Sort</div>
          <select name="sort" defaultValue={f.sort} className="input">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-3">
        <span className="text-xs text-muted">{total.toLocaleString()} match</span>
        <button type="submit" className="btn-primary">
          Apply
        </button>
      </div>
    </form>
  );
}
