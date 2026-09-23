"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { AddressSuggestion } from "@/app/api/israel/address/route";

/**
 * The street field of an Israel ticket with a dropdown of addresses that map (Jonathan, Sep 23, 2026): type a few
 * letters and the geocoder offers matching streets and numbers; picking one writes the street with its house number
 * and fills the city and neighborhood fields of the same form when they are blank. A street without a number is
 * offered greyed as "street only", since an address counts as complete only when it can be found on a map.
 */
export function AddressPicker({ name = "street", value, placeholder = "Ramban 12", cityField = "city", neighborhoodField = "neighborhood" }: { name?: string; value?: string | null; placeholder?: string; cityField?: string; neighborhoodField?: string }) {
  const [text, setText] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<AddressSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const cityOf = () => (input.current?.form?.elements.namedItem(cityField) as HTMLInputElement | null)?.value ?? "";
  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const n = ++seq.current;
      setBusy(true);
      try {
        const r = await fetch(`/api/israel/address?q=${encodeURIComponent(q)}&city=${encodeURIComponent(cityOf())}`);
        const list = (r.ok ? await r.json() : []) as AddressSuggestion[];
        if (n === seq.current) setHits(list);
      } catch {
        if (n === seq.current) setHits([]);
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 450);
  };

  // a picked address fills the blank city and neighborhood of the same form and tells the autosave
  const fill = (field: string, v: string | null) => {
    const el = input.current?.form?.elements.namedItem(field) as HTMLInputElement | HTMLSelectElement | null;
    if (!el || !v || el.value) return;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const pick = (h: AddressSuggestion) => {
    setText(h.street);
    setOpen(false);
    setHits([]);
    const el = input.current;
    if (el) {
      el.value = h.street;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    fill(cityField, h.city);
    fill(neighborhoodField, h.neighborhood);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const mappable = /\d/.test(text);
  return (
    <div className="relative">
      <input
        ref={input}
        name={name}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        className={`input pr-7 ${text && !mappable ? "border-amber-400" : ""}`}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          search(e.target.value);
        }}
        onFocus={() => text.length >= 3 && (setOpen(true), search(text))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title={text && !mappable ? "No house number yet: this address cannot be found on a map, so it still counts as missing." : undefined}
      />
      <MapPin className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${mappable ? "text-emerald-600" : "text-muted"}`} />
      {open && (hits.length > 0 || busy) && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-paper py-1 text-sm shadow-lg">
          {busy && hits.length === 0 && <li className="px-3 py-1.5 text-xs text-muted">Looking up…</li>}
          {hits.map((h) => (
            <li key={h.label}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-cream ${h.exact ? "" : "text-muted"}`}>
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{h.label}</span>
                {!h.exact && <span className="ml-auto shrink-0 text-[10px]">street only</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
