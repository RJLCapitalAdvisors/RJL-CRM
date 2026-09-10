"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Dropdown with checkboxes. Submits one `name` entry per selected option (same as native checkboxes).
 * Ticks are held while the list is open and handed to the form when it closes: an autosaving form used to
 * save (and refresh the page) on every tick, which snapped the list shut under the cursor.
 */
export function MultiSelect({ name, options, selected, placeholder = "Select…", value, onChange }: { name?: string; options: readonly string[]; selected?: string[]; placeholder?: string; value?: string[]; onChange?: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState<string[]>(selected ?? []);
  const sel = value ?? inner;
  const dirty = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const setSel = (next: string[] | ((s: string[]) => string[])) => {
    const v = typeof next === "function" ? next(sel) : next;
    dirty.current = true;
    if (onChange) onChange(v);
    else setInner(v);
  };
  /** Closing is the moment the form hears about the change (one save, list already closed). */
  const close = () => {
    setOpen(false);
    if (dirty.current) {
      dirty.current = false;
      setTimeout(() => ref.current?.querySelector("input[type=hidden]")?.dispatchEvent(new Event("input", { bubbles: true })) ?? ref.current?.dispatchEvent(new Event("input", { bubbles: true })), 0);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (o: string) => setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
  const hold = (e: React.SyntheticEvent) => e.stopPropagation(); // the form does not see ticks while the list is open

  return (
    <div ref={ref} className="relative">
      {name && sel.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      <button type="button" onClick={() => (open ? close() : setOpen(true))} className="input flex min-h-[38px] w-full flex-wrap items-center gap-1 text-left">
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
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-paper p-1 shadow-lg" onChange={hold} onInput={hold}>
          <div className="flex justify-between px-2 py-1 text-[11px] text-muted">
            <button type="button" className="hover:underline" onClick={() => setSel([...options])}>
              All
            </button>
            <button type="button" className="hover:underline" onClick={() => setSel([])}>
              None
            </button>
            <button type="button" className="font-medium text-ink hover:underline" onClick={close}>
              Done
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
