"use client";

import { useRef, useState, useTransition } from "react";
import { addTrackerContactAction, searchContactsForTracker } from "./actions";

type Opt = { id: string; name: string; city: string | null; state: string | null };

export function TrackerContactPicker({ dealId, autoFocus = false, onAdded }: { dealId: string; autoFocus?: boolean; onAdded?: () => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Opt[]>([]);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) return setOpts([]);
    timer.current = setTimeout(() => searchContactsForTracker(v).then(setOpts), 200);
  }

  return (
    <div className="relative w-72">
      <input value={q} onChange={(e) => onChange(e.target.value)} placeholder="Add investor by name, email, or firm…" className="input text-sm" autoFocus={autoFocus} />
      {opts.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-paper shadow-lg">
          {opts.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-cream"
                onClick={() => {
                  const fd = new FormData();
                  fd.set("contactId", o.id);
                  setQ("");
                  setOpts([]);
                  start(async () => {
                    await addTrackerContactAction(dealId, fd);
                    onAdded?.();
                  });
                }}
              >
                {o.name}
                <span className="text-muted">
                  {o.state ? ` · ${o.state}` : ""}
                  {o.city ? ` · ${o.city}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
