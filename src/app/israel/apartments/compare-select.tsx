"use client";

import Link from "next/link";
import { createContext, useContext, useState } from "react";

/**
 * Compare mode on the Apartments list: a tick box at the left of every row, up to five picks, and a bar at the
 * bottom that opens the side-by-side comparison. Selection lives here; the rows only render their box.
 */
const Ctx = createContext<{ picked: string[]; toggle: (id: string) => void } | null>(null);
export const MAX_COMPARE = 5;

export function CompareProvider({ children, basePath = "/israel/apartments", noun = "apartments" }: { children: React.ReactNode; basePath?: string; noun?: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id]));
  return (
    <Ctx.Provider value={{ picked, toggle }}>
      {children}
      <div className="sticky bottom-0 z-10 mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-2.5 text-sm shadow-lg">
        <span className="text-muted">
          {picked.length === 0 ? `Tick up to ${MAX_COMPARE} ${noun} to compare.` : `${picked.length} of ${MAX_COMPARE} picked${picked.length >= MAX_COMPARE ? " (the most that fit side by side)" : ""}.`}
        </span>
        <div className="flex items-center gap-2">
          {picked.length > 0 && (
            <button type="button" className="text-xs text-muted hover:underline" onClick={() => setPicked([])}>
              Clear
            </button>
          )}
          {picked.length >= 2 ? (
            <Link href={`${basePath}/compare?ids=${picked.join(",")}`} className="btn-primary px-4 py-1.5">
              Compare {picked.length} {noun === "houses" ? "houses" : "units"}
            </Link>
          ) : (
            <span className="btn-primary cursor-not-allowed px-4 py-1.5 opacity-40">Compare {noun === "houses" ? "houses" : "units"}</span>
          )}
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function CompareCheck({ id, name }: { id: string; name: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const on = ctx.picked.includes(id);
  const full = !on && ctx.picked.length >= MAX_COMPARE;
  return <input type="checkbox" aria-label={`Compare ${name}`} checked={on} disabled={full} onChange={() => ctx.toggle(id)} className="h-4 w-4 accent-sky-600 disabled:opacity-30" title={full ? `Up to ${MAX_COMPARE} units at a time` : on ? "Picked for comparison" : "Pick for comparison"} />;
}
