"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * A field shown as a token (chip). Click it, pick a value, and it saves itself. Used for the kind of an RJL Israel
 * company on its page: one click to change, no form, no Save button.
 */
export function TokenPicker({ value, options, action, empty = "Set kind", className = "" }: { value: string | null; options: readonly string[]; action: (value: string | null) => Promise<void>; empty?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(value);
  const [busy, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setCurrent(value), [value]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const pick = (v: string | null) => {
    setCurrent(v);
    setOpen(false);
    start(() => action(v));
  };
  return (
    <div ref={box} className={`relative inline-block ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="Click to change" className={`chip cursor-pointer text-[11px] transition ${current ? "bg-sky text-ink hover:brightness-95" : "border border-dashed border-line bg-transparent text-muted hover:text-ink"} ${busy ? "opacity-60" : ""}`}>
        {current ?? empty}
        <span aria-hidden className="ml-1 text-[9px] opacity-60">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-md border border-line bg-paper py-1 text-sm shadow-lg">
          {options.map((o) => (
            <button key={o} type="button" onClick={() => pick(o)} className={`block w-full px-3 py-1.5 text-left hover:bg-cream ${o === current ? "font-semibold" : ""}`}>
              {o}
            </button>
          ))}
          {current && (
            <button type="button" onClick={() => pick(null)} className="block w-full border-t border-line px-3 py-1.5 text-left text-muted hover:bg-cream">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
