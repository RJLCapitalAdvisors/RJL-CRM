"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { combinePortfolioAction, portfolioCandidatesAction, portfolioSelfAction } from "../actions";

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
  // "this ticket is the portfolio" when it already carries the report, the letter or components; else a new ticket
  const [self, setSelf] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // the panel floats over the page (position fixed) so the ticket's narrow, scrolling left column cannot clip it (Jonathan, Oct 8, 2026: the text was cut off on the left)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(384, window.innerWidth - 16);
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
  };

  useEffect(() => {
    if (!open) return;
    if (!cands) portfolioCandidatesAction(dealId).then(setCands);
    if (self === null) portfolioSelfAction(dealId).then(setSelf);
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, cands, self, dealId]);

  const go = () =>
    start(async () => {
      setErr(null);
      const r = await combinePortfolioAction([dealId, ...picked], name, self ? dealId : null);
      if (r && "error" in r) setErr(r.error);
    });

  return (
    <div ref={box} className="relative">
      <button ref={btn} type="button" className="btn-secondary" onClick={() => { if (!open) place(); setOpen((o) => !o); }} title="Take this and other tickets from the same sponsor out together as one deal">
        Combine into portfolio
      </button>
      {open && (
        <div className="fixed z-50 w-96 max-w-[calc(100vw-16px)] rounded-md border border-line bg-paper p-3 text-sm shadow-lg" style={at ? { top: at.top, left: at.left } : undefined}>
          <div className="mb-2 text-xs text-muted">
            Tickets from the same sponsor to take out together with <b>{dealName}</b>. The portfolio&apos;s numbers are the sum of the properties&apos; capital stacks; the email gets one intro in the plural, the totals, a Deal Metrics block per property, one business plan and one sponsor bio.
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
          <div className="mt-2 space-y-1 text-xs">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="pf-into" className="mt-0.5 accent-sky-600" checked={self === true} onChange={() => setSelf(true)} />
              <span><b>{dealName}</b> is the portfolio: the ticked tickets become its properties. Its report, agreed groups, letter and emails stay; its numbers become the sum.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="pf-into" className="mt-0.5 accent-sky-600" checked={self === false} onChange={() => setSelf(false)} />
              <span>Make a new portfolio ticket with all of them as properties.</span>
            </label>
          </div>
          {self === false && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Portfolio name (optional), e.g. Tides Sunbelt Portfolio" className="input mt-2 text-xs" />}
          {err && <div className="mt-1 text-xs text-red-700">{err}</div>}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted">{picked.length + 1} tickets</span>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || picked.length === 0 || self === null} onClick={go}>
              {busy ? "Combining…" : self ? "Add to this portfolio" : "Create portfolio"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
