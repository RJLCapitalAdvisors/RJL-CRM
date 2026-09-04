"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ASSET_CLASSES, ROLES, US_STATES } from "@/lib/taxonomy";
import { MultiSelect } from "./multi-select";

export type ListFilterState = { q: string; roles: string[]; assets: string[]; state?: string };

/** Filter bar for the Companies and Contacts lists. No Search button: every change re-filters the list. */
export function ListFilters({ basePath, initial, placeholder, withState = false }: { basePath: string; initial: ListFilterState; placeholder: string; withState?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [roles, setRoles] = useState(initial.roles);
  const [assets, setAssets] = useState(initial.assets);
  const [state, setState] = useState(initial.state ?? "");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const u = new URLSearchParams();
      if (q.trim()) u.set("q", q.trim());
      for (const r of roles) u.append("role", r);
      for (const a of assets) u.append("asset", a);
      if (state) u.set("state", state);
      const qs = u.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath);
    }, 250);
    return () => clearTimeout(t);
  }, [q, roles, assets, state, basePath, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input w-72 pl-8" />
      </div>
      <div className="w-52">
        <MultiSelect options={ROLES} value={roles} onChange={setRoles} placeholder="All roles" />
      </div>
      <div className="w-64">
        <MultiSelect options={ASSET_CLASSES} value={assets} onChange={setAssets} placeholder="All asset classes" />
      </div>
      {withState && (
        <select value={state} onChange={(e) => setState(e.target.value)} className="input w-32">
          <option value="">All states</option>
          {Object.keys(US_STATES).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
