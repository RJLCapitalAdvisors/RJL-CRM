"use client";

import { RangeSlider } from "@/components/range-slider";
import { MultiSelect } from "@/components/multi-select";
import type { Stop } from "@/lib/ranges";
import { IL_DIRECTIONS, IL_PARKING, IL_SELLER_TYPES } from "@/lib/israel";
import { MIRPESET_STOPS, ROOMS_STOPS, YEAR_STOPS } from "../apartments/filters";

export type HouseFilters = {
  q: string;
  cities: string[];
  neighborhoods: string[];
  sqmMin: number | null;
  sqmMax: number | null;
  mirpesetMin: number | null;
  mirpesetMax: number | null;
  migrashMin: number | null;
  migrashMax: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
  floorsMin: number | null;
  floorsMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  parking: string[];
  sellerTypes: string[];
  directions: string[];
  mamad: string;
  sukka: string;
  sort: string;
};

export const HOUSE_SQM_STOPS: Stop[] = Array.from({ length: (600 - 80) / 10 + 1 }, (_, i) => ({ value: 80 + i * 10, label: 80 + i * 10 >= 600 ? "600 m²+" : `${80 + i * 10} m²` }));
export const MIGRASH_STOPS: Stop[] = Array.from({ length: 2000 / 50 + 1 }, (_, i) => ({ value: i * 50, label: i * 50 >= 2000 ? "2 dunam+" : i * 50 >= 1000 ? `${(i * 50) / 1000} dunam` : `${i * 50} m²` }));
export const FLOORS_STOPS: Stop[] = Array.from({ length: 6 }, (_, i) => ({ value: i + 1, label: i + 1 >= 6 ? "6+" : String(i + 1) }));

export const HOUSE_SORTS: { value: string; label: string }[] = [
  { value: "updated", label: "Recently touched" },
  { value: "ppm-asc", label: "Price per meter, low to high" },
  { value: "ppm-desc", label: "Price per meter, high to low" },
  { value: "price-asc", label: "Asking price, low to high" },
  { value: "price-desc", label: "Asking price, high to low" },
  { value: "sqm-desc", label: "Internal m², largest first" },
  { value: "sqm-asc", label: "Internal m², smallest first" },
  { value: "migrash-desc", label: "Migrash, largest first" },
  { value: "year-desc", label: "Newest built or delivery first" },
  { value: "year-asc", label: "Oldest built first" },
  { value: "name", label: "Name" },
];

/** The houses filter rail, the apartments rail with house fields: migrash and floors instead of floor and machsan, sukka on the mirpeset. */
export function HouseFiltersPanel({ f, cities, neighborhoods, total, compare }: { f: HouseFilters; cities: string[]; neighborhoods: string[]; total: number; compare: boolean }) {
  return (
    <form method="get" action="/israel/houses" className="card space-y-4 p-4 text-sm">
      {compare && <input type="hidden" name="compare" value="1" />}
      <div className="flex items-center justify-between">
        <div className="font-semibold">Filters</div>
        <a href={compare ? "/israel/houses?compare=1" : "/israel/houses"} className="text-xs text-muted hover:underline">
          Clear all
        </a>
      </div>
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
        <div className="label">Internal m²</div>
        <RangeSlider name="sqm" stops={HOUSE_SQM_STOPS} min={f.sqmMin} max={f.sqmMax} />
      </div>
      <div>
        <div className="label">Mirpeset m²</div>
        <RangeSlider name="mirpeset" stops={MIRPESET_STOPS} min={f.mirpesetMin} max={f.mirpesetMax} />
      </div>
      <div>
        <div className="label">Migrash</div>
        <RangeSlider name="migrash" stops={MIGRASH_STOPS} min={f.migrashMin} max={f.migrashMax} />
      </div>
      <div>
        <div className="label">Rooms</div>
        <RangeSlider name="rooms" stops={ROOMS_STOPS} min={f.roomsMin} max={f.roomsMax} />
      </div>
      <div>
        <div className="label">Floors</div>
        <RangeSlider name="floors" stops={FLOORS_STOPS} min={f.floorsMin} max={f.floorsMax} />
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
        <div className="label">Mirpeset direction</div>
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
          <div className="label">Sukka</div>
          <select name="sukka" defaultValue={f.sukka} className="input">
            <option value="">Any</option>
            <option value="yes">Yes</option>
            <option value="partial">Partial or yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>
      <div>
        <div className="label">Sort by</div>
        <select name="sort" defaultValue={f.sort} className="input">
          {HOUSE_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary w-full justify-center">
        Show {total.toLocaleString()} houses
      </button>
    </form>
  );
}
