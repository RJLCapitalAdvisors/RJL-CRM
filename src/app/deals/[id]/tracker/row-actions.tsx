"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { removeTrackerRow } from "./actions";
import { TrackerContactPicker } from "./contact-picker";

/**
 * The little column at the right of each report row (Jonathan, Sep 23, 2026): + adds a row (the investor picker opens
 * right there), − removes this row after a second click that asks. A removed row can still be undone from the strip
 * above the table for 30 days.
 */
export function RowActions({ dealId, rowId, label }: { dealId: string; rowId: string; label: string }) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="relative flex items-center gap-1 whitespace-nowrap text-muted">
      <button type="button" onClick={() => { setAdding((v) => !v); setConfirming(false); }} className="rounded p-0.5 hover:bg-cream hover:text-sky-700" title="Add an investor row">
        <Plus className="h-3.5 w-3.5" />
      </button>
      {confirming ? (
        <span className="inline-flex items-center gap-1 text-[10px]">
          <span className="text-red-700">Remove {label}?</span>
          <button type="button" disabled={pending} className="rounded bg-red-700 px-1.5 py-0.5 text-white hover:bg-red-800" onClick={() => start(async () => { await removeTrackerRow(rowId); setConfirming(false); router.refresh(); })}>
            {pending ? "…" : "Yes"}
          </button>
          <button type="button" className="rounded px-1 py-0.5 hover:bg-cream" onClick={() => setConfirming(false)}>
            No
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => { setConfirming(true); setAdding(false); }} className="rounded p-0.5 hover:bg-cream hover:text-red-700" title="Remove this row from the report">
          <Minus className="h-3.5 w-3.5" />
        </button>
      )}
      {adding && (
        <div className="absolute right-0 top-6 z-30 rounded-md border border-line bg-paper p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
          <TrackerContactPicker dealId={dealId} autoFocus onAdded={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}
