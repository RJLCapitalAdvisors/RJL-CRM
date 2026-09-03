"use client";

import { useRef, useState } from "react";
import { searchCompanies } from "@/app/contacts/actions";

type Opt = { id: string; name: string; city: string | null; state: string | null };

export function CompanyPicker({ initial }: { initial: Opt | null }) {
  const [selected, setSelected] = useState<Opt | null>(initial);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Opt[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setOpts([]);
      return;
    }
    timer.current = setTimeout(() => {
      searchCompanies(value).then(setOpts);
    }, 200);
  }

  return (
    <div>
      <input type="hidden" name="companyId" value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between rounded-md border border-line bg-cream-50 px-3 py-2 text-sm">
          <span>
            {selected.name}
            {(selected.city || selected.state) && <span className="text-muted"> · {[selected.city, selected.state].filter(Boolean).join(", ")}</span>}
          </span>
          <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setSelected(null)}>
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <input value={q} onChange={(e) => onChange(e.target.value)} placeholder="Search companies…" className="input" />
          {opts.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-paper shadow-lg">
              {opts.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-cream"
                    onClick={() => {
                      setSelected(o);
                      setQ("");
                      setOpts([]);
                    }}
                  >
                    {o.name}
                    {(o.city || o.state) && <span className="text-muted"> · {[o.city, o.state].filter(Boolean).join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
