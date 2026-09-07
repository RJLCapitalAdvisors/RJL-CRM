"use client";

import { useState } from "react";

/**
 * Two-handle slider over an ordered list of buckets (check sizes, hold periods, vintages).
 * Picks a contiguous span; submits one hidden `name` entry per bucket in the span, exactly like the
 * multi-select did, so the stored data is unchanged and the old control can be swapped back in.
 * "Any" (nothing selected) is the empty state; drag a handle to start choosing.
 */
export function RangeSlider({ name, options, selected, anyLabel = "Any" }: { name: string; options: readonly string[]; selected: string[]; anyLabel?: string }) {
  const idx = selected.map((s) => options.indexOf(s)).filter((i) => i >= 0);
  const [lo, setLo] = useState(idx.length ? Math.min(...idx) : -1);
  const [hi, setHi] = useState(idx.length ? Math.max(...idx) : -1);
  const max = options.length - 1;
  const active = lo >= 0 && hi >= 0;
  const a = active ? lo : 0;
  const b = active ? hi : max;
  const pct = (i: number) => (max === 0 ? 0 : (i / max) * 100);
  const label = !active ? anyLabel : a === b ? options[a] : `${options[a]} to ${options[b]}`;

  return (
    <div className="pt-1">
      {active && options.slice(a, b + 1).map((o) => <input key={o} type="hidden" name={name} value={o} />)}
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
          max={max}
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
          max={max}
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
        <span>{options[0]}</span>
        <span>{options[max]}</span>
      </div>
    </div>
  );
}
