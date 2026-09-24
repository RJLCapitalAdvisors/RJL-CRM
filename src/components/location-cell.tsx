"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setCompanyGeography } from "@/app/companies/actions";

/**
 * Deal locations in a company row (Jonathan, Sep 24, 2026): where the firm invests or builds, as the free text the
 * criteria carry ("Sunbelt", "Top 25 MSAs", "NJ and PA"). Click to edit in place; saves when the box closes
 * (investors' edits go to Jonathan for approval unless you are him, like asset classes).
 */
export function LocationCell({ companyId, text }: { companyId: string; text: string | null }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(text ?? "");
  const saved = useRef(text ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    const next = val.trim();
    if (next === saved.current.trim()) return;
    saved.current = next;
    start(async () => {
      const res = await setCompanyGeography(companyId, next);
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
  }, [open, val]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} className="flex min-h-[22px] max-w-[260px] items-center gap-1 rounded px-1 text-left hover:bg-cream" title={val ? `${val}\n\nClick to change deal locations` : "Click to add deal locations"}>
        <span className="truncate">{val.trim() ? val : <span className="text-muted">—</span>}</span>
        {note && <span className="ml-1 shrink-0 text-[10px] text-muted">{note}</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-line bg-paper p-2 shadow-lg">
          <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} rows={3} placeholder="Sunbelt; Top 25 MSAs; NJ and PA…" className="input w-full resize-y text-sm" onKeyDown={(e) => { if (e.key === "Escape") { setVal(saved.current); setOpen(false); } if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); close(); } }} />
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
            <span>Enter saves, Shift+Enter for a new line</span>
            <button type="button" className="rounded bg-ink px-2 py-1 text-xs text-white" onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
