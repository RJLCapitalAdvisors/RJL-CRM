"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** City, room count, search, and "typed only": the filters above the rent table, carried in the address so a page reload keeps them. */
export function RentsFilters({ cities, initial }: { cities: { city: string; n: number }[]; initial: { city: string; q: string; rooms: number; filled: boolean } }) {
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
  return (
    <>
      <select className="input w-56 py-1 text-sm" value={initial.city} onChange={(e) => go({ city: e.target.value })}>
        <option value="">All cities and towns</option>
        {cities.map((c) => (
          <option key={c.city} value={c.city}>
            {c.city} ({c.n})
          </option>
        ))}
      </select>
      <select className="input w-32 py-1 text-sm" value={initial.rooms || ""} onChange={(e) => go({ rooms: e.target.value })}>
        <option value="">All rooms</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
          <option key={r} value={r}>
            {r} rooms
          </option>
        ))}
      </select>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a neighborhood or city" className="input w-64 py-1 text-sm" />
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" className="accent-ink" checked={initial.filled} onChange={(e) => go({ filled: e.target.checked ? "1" : "" })} /> typed only
      </label>
    </>
  );
}
