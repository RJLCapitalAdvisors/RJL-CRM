"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { combinePortfolioAction, portfolioCandidatesAction } from "../actions";

type Cand = { id: string; name: string; city: string | null; stage: string; ask: string | null };

/**
 * Combine into portfolio: pick the sponsor's other tickets to take out together with this one. A new portfolio
 * ticket is created with the totals and one narrative; the property tickets become its components.
 */
export function CombinePortfolio({ dealId, dealName }: { dealId: string; dealName: string }) {
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!cands) portfolioCandidatesAction(dealId).then(setCands);
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, cands, dealId]);

  const go = () =>
    start(async () => {
      setErr(null);
      const r = await combinePortfolioAction([dealId, ...picked], name);
      if (r && "error" in r) setErr(r.error);
    });

  return (
    <div ref={box} className="relative">
      <button type="button" className="btn-secondary" onClick={() => setOpen((o) => !o)} title="Take this and other tickets from the same sponsor out together as one deal">
        Combine into portfolio
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-96 rounded-md border border-line bg-paper p-3 text-sm shadow-lg">
          <div className="mb-2 text-xs text-muted">
            Tickets from the same sponsor to take out together with <b>{dealName}</b>. The email gets one intro, a Deal Metrics block per property, one business plan and one sponsor bio.
          </div>
          {!cands ? (
            <div className="py-3 text-center text-xs text-muted">Loading…</div>
          ) : cands.length === 0 ? (
            <div className="py-3 text-center text-xs text-muted">No other live tickets from this sponsor.</div>
          ) : (
            <ul className="max-h-56 divide-y divide-line overflow-auto">
              {cands.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-2 px-1 py-1.5 hover:bg-cream">
                    <input type="checkbox" className="mt-0.5 accent-sky-600" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{[c.city, c.stage, c.ask].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Portfolio name (optional), e.g. Tides Sunbelt Portfolio" className="input mt-2 text-xs" />
          {err && <div className="mt-1 text-xs text-red-700">{err}</div>}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted">{picked.length + 1} tickets</span>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || picked.length === 0} onClick={go}>
              {busy ? "Combining…" : "Create portfolio"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
