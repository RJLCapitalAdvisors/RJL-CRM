"use client";

import { useEffect, useRef, useState } from "react";

/** Dropdown with checkboxes. Submits one `name` entry per selected option (same as native checkboxes). */
export function MultiSelect({ name, options, selected, placeholder = "Select…" }: { name: string; options: readonly string[]; selected: string[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (o: string) => setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));

  return (
    <div ref={ref} className="relative">
      {sel.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex min-h-[38px] w-full flex-wrap items-center gap-1 text-left">
        {sel.length === 0 ? (
          <span className="text-muted">{placeholder}</span>
        ) : (
          options
            .filter((o) => sel.includes(o))
            .map((v) => (
              <span key={v} className="chip bg-sky text-ink">
                {v}
              </span>
            ))
        )}
        <span className="ml-auto text-muted">⌄</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-paper p-1 shadow-lg">
          <div className="flex justify-between px-2 py-1 text-[11px] text-muted">
            <button type="button" className="hover:underline" onClick={() => setSel([...options])}>
              All
            </button>
            <button type="button" className="hover:underline" onClick={() => setSel([])}>
              None
            </button>
          </div>
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-cream">
              <input type="checkbox" checked={sel.includes(o)} onChange={() => toggle(o)} className="accent-ink" />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
