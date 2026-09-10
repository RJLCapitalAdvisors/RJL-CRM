"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ASSET_CLASSES } from "@/lib/taxonomy";
import { setCompanyAssetClasses } from "@/app/companies/actions";

/**
 * Asset classes in a list row: click to tick, saves once when the list closes (sponsors directly; investors go
 * to Jonathan for approval unless you are him). Saving on every tick refreshed the page and shut the list.
 */
export function AssetCell({ companyId, assetClasses }: { companyId: string; assetClasses: string[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(assetClasses);
  const saved = useRef<string[]>(assetClasses);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    const changed = sel.length !== saved.current.length || sel.some((x) => !saved.current.includes(x));
    if (!changed) return;
    saved.current = sel;
    start(async () => {
      const res = await setCompanyAssetClasses(companyId, sel);
      setNote(res.proposed ? "sent to Jonathan" : "saved");
      setTimeout(() => setNote(null), 2000);
    });
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sel]);

  const toggle = (a: string) => setSel((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} className="flex min-h-[22px] max-w-[260px] items-center gap-1 rounded px-1 text-left hover:bg-cream" title="Click to change asset classes">
        <span className="truncate">{sel.length ? sel.join(", ") : <span className="text-muted">—</span>}</span>
        {note && <span className="ml-1 shrink-0 text-[10px] text-muted">{note}</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-line bg-paper p-2 shadow-lg">
          {ASSET_CLASSES.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-cream">
              <input type="checkbox" checked={sel.includes(a)} onChange={() => toggle(a)} className="accent-ink" />
              {a}
            </label>
          ))}
          <button type="button" className="mt-1 w-full rounded bg-ink px-2 py-1 text-xs text-white" onClick={close}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
