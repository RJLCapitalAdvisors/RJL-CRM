"use client";

import { RangeSlider } from "@/components/range-slider";
import { MultiSelect } from "@/components/multi-select";
import type { Stop } from "@/lib/ranges";
import { IL_DIRECTIONS, IL_PARKING, IL_SELLER_TYPES } from "@/lib/israel";

export type AptFilters = {
  q: string;
  cities: string[];
  neighborhoods: string[];
  sqmMin: number | null;
  sqmMax: number | null;
  mirpesetMin: number | null;
  mirpesetMax: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
  floorMin: number | null;
  floorMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  parking: string[];
  sellerTypes: string[];
  directions: string[];
  mamad: string;
  machsan: string;
  sort: string;
};

export const SQM_STOPS: Stop[] = Array.from({ length: (300 - 40) / 5 + 1 }, (_, i) => ({ value: 40 + i * 5, label: 40 + i * 5 >= 300 ? "300 m²+" : `${40 + i * 5} m²` }));
export const MIRPESET_STOPS: Stop[] = Array.from({ length: 100 / 5 + 1 }, (_, i) => ({ value: i * 5, label: i * 5 >= 100 ? "100 m²+" : `${i * 5} m²` }));
export const ROOMS_STOPS: Stop[] = Array.from({ length: (8 - 1) * 2 + 1 }, (_, i) => ({ value: 1 + i / 2, label: 1 + i / 2 >= 8 ? "8+" : String(1 + i / 2) }));
export const FLOOR_STOPS: Stop[] = Array.from({ length: 41 }, (_, i) => ({ value: i, label: i === 0 ? "Ground" : i >= 40 ? "40+" : String(i) }));
export const YEAR_STOPS: Stop[] = Array.from({ length: 2035 - 1950 + 1 }, (_, i) => ({ value: 1950 + i, label: i === 0 ? "Before 1950" : String(1950 + i) }));

export const SORTS: { value: string; label: string }[] = [
  { value: "updated", label: "Recently touched" },
  { value: "ppm-asc", label: "Price per meter, low to high" },
  { value: "ppm-desc", label: "Price per meter, high to low" },
  { value: "price-asc", label: "Asking price, low to high" },
  { value: "price-desc", label: "Asking price, high to low" },
  { value: "sqm-desc", label: "Internal m², largest first" },
  { value: "sqm-asc", label: "Internal m², smallest first" },
  { value: "year-desc", label: "Newest built or delivery first" },
  { value: "year-asc", label: "Oldest built first" },
  { value: "name", label: "Name" },
];

/** The apartments filter rail: every field except asking price, ranges as sliders, plus a sort. A plain GET form, so a filtered list has a shareable URL. */
export function ApartmentFilters({ f, cities, neighborhoods, total }: { f: AptFilters; cities: string[]; neighborhoods: string[]; total: number }) {
  return (
    <form method="get" action="/israel/apartments" className="card space-y-4 p-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Filters</div>
        <a href="/israel/apartments" className="text-xs text-muted hover:underline">
          Clear all
        </a>
      </div>
      <input name="q" defaultValue={f.q} placeholder="Search name, address, project, developer" className="input" />
      <div>
        <div className="label">City</div>
        <MultiSelect name="city" options={cities} selected={f.cities} placeholder="Any city" />
      </div>
      <div>
        <div className="label">Neighborhood</div>
        <MultiSelect name="neighborhood" options={neighborhoods} selected={f.neighborhoods} placeholder="Any neighborhood" />
      </div>
      <div>
        <div className="label">Internal m²</div>
        <RangeSlider name="sqm" stops={SQM_STOPS} min={f.sqmMin} max={f.sqmMax} />
      </div>
      <div>
        <div className="label">Mirpeset m²</div>
        <RangeSlider name="mirpeset" stops={MIRPESET_STOPS} min={f.mirpesetMin} max={f.mirpesetMax} />
      </div>
      <div>
        <div className="label">Rooms</div>
        <RangeSlider name="rooms" stops={ROOMS_STOPS} min={f.roomsMin} max={f.roomsMax} />
      </div>
      <div>
        <div className="label">Floor</div>
        <RangeSlider name="floor" stops={FLOOR_STOPS} min={f.floorMin} max={f.floorMax} />
      </div>
      <div>
        <div className="label">Built or expected delivery</div>
        <RangeSlider name="year" stops={YEAR_STOPS} min={f.yearMin} max={f.yearMax} />
      </div>
      <div>
        <div className="label">Parking</div>
        <MultiSelect name="parking" options={IL_PARKING} selected={f.parking} placeholder="Any" />
      </div>
      <div>
        <div className="label">Seller type</div>
        <MultiSelect name="sellerType" options={IL_SELLER_TYPES} selected={f.sellerTypes} placeholder="Any" />
      </div>
      <div>
        <div className="label">Apartment direction</div>
        <MultiSelect name="direction" options={IL_DIRECTIONS} selected={f.directions} placeholder="Any" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="label">Mamad</div>
          <select name="mamad" defaultValue={f.mamad} className="input">
            <option value="">Any</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <div className="label">Machsan</div>
          <select name="machsan" defaultValue={f.machsan} className="input">
            <option value="">Any</option>
            <option value="yes">Has one</option>
            <option value="no">None</option>
          </select>
        </div>
      </div>
      <div>
        <div className="label">Sort by</div>
        <select name="sort" defaultValue={f.sort} className="input">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary w-full justify-center">
        Show {total.toLocaleString()} apartments
      </button>
    </form>
  );
}
