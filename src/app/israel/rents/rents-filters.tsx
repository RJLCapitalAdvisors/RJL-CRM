"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** The filter card beside the rent table, in the shape of the apartments page's: city, rooms, search, typed only. Carried in the address so a reload keeps them. */
export function RentsFilters({ cities, initial, total, typed }: { cities: { city: string; n: number }[]; initial: { city: string; q: string; rooms: number; filled: boolean }; total: number; typed: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial.q);
  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    u.delete("page");
    router.push(`/israel/rents?${u.toString()}`);
  };
  useEffect(() => {
    if (q === initial.q) return;
    const t = setTimeout(() => go({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const any = initial.city || initial.q || initial.rooms || initial.filled;
  return (
    <aside className="card h-fit p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Filters</h2>
        {any ? (
          <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => router.push("/israel/rents")}>
            Clear
          </button>
        ) : null}
      </div>
      <label className="mb-1 block text-xs text-muted">Search</label>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Neighborhood or city" className="input mb-3 w-full py-1 text-sm" />
      <label className="mb-1 block text-xs text-muted">City or town</label>
      <select className="input mb-3 w-full py-1 text-sm" value={initial.city} onChange={(e) => go({ city: e.target.value })}>
        <option value="">All ({cities.reduce((n, c) => n + c.n, 0).toLocaleString("en-US")} neighborhoods)</option>
        {cities.map((c) => (
          <option key={c.city} value={c.city}>
            {c.city} ({c.n})
          </option>
        ))}
      </select>
      <label className="mb-1 block text-xs text-muted">Rooms</label>
      <select className="input mb-3 w-full py-1 text-sm" value={initial.rooms || ""} onChange={(e) => go({ rooms: e.target.value })}>
        <option value="">All room counts</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
          <option key={r} value={r}>
            {r} rooms
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-ink" checked={initial.filled} onChange={(e) => go({ filled: e.target.checked ? "1" : "" })} /> Only rows with a rent typed
      </label>
      <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
        {total.toLocaleString("en-US")} rows shown · {typed.toLocaleString("en-US")} rents typed in all
      </div>
    </aside>
  );
}
