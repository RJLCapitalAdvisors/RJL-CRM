"use client";

import { useState } from "react";
import type { Stop } from "@/lib/ranges";

/**
 * Two-handle slider over ordered stops (e.g. $1MM … $100MM+ in $1MM steps). Submits `${name}Min` and
 * `${name}Max` as the stop values; empty when cleared ("Any"). Drag a handle to start choosing.
 */
export function RangeSlider({ name, stops, min, max, anyLabel = "Any" }: { name: string; stops: Stop[]; min: number | null | undefined; max: number | null | undefined; anyLabel?: string }) {
  const idxOf = (v: number | null | undefined) => (v == null ? -1 : stops.findIndex((s) => s.value === v));
  const [lo, setLo] = useState(idxOf(min));
  const [hi, setHi] = useState(idxOf(max));
  const last = stops.length - 1;
  const active = lo >= 0 && hi >= 0;
  const a = active ? lo : 0;
  const b = active ? hi : last;
  const pct = (i: number) => (last === 0 ? 0 : (i / last) * 100);
  const label = !active ? anyLabel : a === b ? stops[a].label : `${stops[a].label} to ${stops[b].label}`;

  return (
    <div className="pt-1">
      <input type="hidden" name={`${name}Min`} value={active ? stops[a].value : ""} />
      <input type="hidden" name={`${name}Max`} value={active ? stops[b].value : ""} />
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className={active ? "font-medium" : "text-muted"}>{label}</span>
        {active && (
          <button
            type="button"
            className="text-xs text-muted hover:underline"
            onClick={() => {
              setLo(-1);
              setHi(-1);
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="relative h-8">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        <div className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${active ? "bg-sky-600" : "bg-sky"}`} style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }} />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={a}
          aria-label={`${name} from`}
          className="range-thumb absolute inset-0 w-full"
          onChange={(e) => {
            const v = Number(e.target.value);
            setLo(Math.min(v, b));
            setHi(b);
          }}
        />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={b}
          aria-label={`${name} to`}
          className="range-thumb absolute inset-0 w-full"
          onChange={(e) => {
            const v = Number(e.target.value);
            setHi(Math.max(v, a));
            setLo(a);
          }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{stops[0].label}</span>
        <span>{stops[last].label}</span>
      </div>
    </div>
  );
}
