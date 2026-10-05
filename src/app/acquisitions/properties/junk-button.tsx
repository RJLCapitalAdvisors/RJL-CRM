"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Undo2 } from "lucide-react";
import { junkAqProperty, restoreAqProperty } from "../junk-actions";

/**
 * On a property ticket (Oct 5, 2026): "Move to Junk" asks for the reason, then the whole card goes to Junk > Junk
 * Properties. A junk ticket shows the red banner with the reason, the date and the source file, and Restore.
 */
export function JunkButton({ id, address }: { id: string; address: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs text-red-700" onClick={() => setOpen(true)} title="Send this property and everything on its card to Junk Properties">
        <Trash2 className="h-3.5 w-3.5" />
        Move to Junk
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="card w-full max-w-md p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold">Move this property to Junk?</div>
            <p className="mt-2 text-ink-soft">“{address}” leaves the Properties list, the map, the pipeline and the dashboard with everything on its card. It sits under Junk &gt; Junk Properties, still found by a search, and can be restored.</p>
            <label className="mt-3 block text-xs text-muted">Removed Reason</label>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="gas station, too small, corporate-owned, duplicate of 656 Ocean Rd…" className="input mt-1 w-full" />
            {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => setOpen(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn-primary bg-red-700 px-3 py-1.5 text-xs hover:bg-red-800"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await junkAqProperty(id, reason.trim());
                    if (!r.ok) {
                      setError(r.reason);
                      return;
                    }
                    setOpen(false);
                    router.push(r.redirect ?? "/acquisitions/properties");
                  })
                }
              >
                {pending ? "Moving…" : "Yes, move to Junk"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function JunkBanner({ id, reason, at, source, by }: { id: string; reason: string | null; at: Date | string; source: string | null; by: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const when = new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      <div className="min-w-0">
        <div className="font-semibold">Junk{reason ? ` – ${reason}` : ""}</div>
        <div className="text-xs text-red-800/80">
          Removed {when}
          {by ? ` by ${by}` : ""}
          {source ? ` · Source file: ${source}` : ""} · off the Properties list, the map, the pipeline and the dashboard; the card is kept.
        </div>
      </div>
      <button
        type="button"
        disabled={pending}
        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
        title="Back to the live Properties list with everything on the card"
        onClick={() =>
          start(async () => {
            await restoreAqProperty(id);
            router.refresh();
          })
        }
      >
        <Undo2 className="h-3.5 w-3.5" />
        {pending ? "Restoring…" : "Restore"}
      </button>
    </div>
  );
}
