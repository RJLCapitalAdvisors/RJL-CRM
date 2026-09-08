"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ASSET_CLASSES } from "@/lib/taxonomy";
import { setCompanyAssetClasses } from "@/app/companies/actions";

/** Asset classes in a list row: click to tick; saves as you tick (sponsors directly; investors go to Jonathan for approval unless you are him). */
export function AssetCell({ companyId, assetClasses }: { companyId: string; assetClasses: string[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(assetClasses);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (a: string) => {
    const next = sel.includes(a) ? sel.filter((x) => x !== a) : [...sel, a];
    setSel(next);
    start(async () => {
      const res = await setCompanyAssetClasses(companyId, next);
      setNote(res.proposed ? "sent to Jonathan" : null);
    });
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-[22px] max-w-[260px] items-center gap-1 rounded px-1 text-left hover:bg-cream" title="Click to change asset classes">
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
        </div>
      )}
    </div>
  );
}
