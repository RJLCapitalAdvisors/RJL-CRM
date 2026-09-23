"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { aqDealStageTone, type AqPipeline } from "@/lib/acquisitions";
import { addAqStage, deleteAqStage, moveAqStage, renameAqStage } from "../actions";

type R = { ok: true } | { ok: false; reason: string };

/**
 * Edit stages: a panel under the pipeline header where a stage is added, renamed, moved left or right (Dead to the
 * front, say) or removed once empty. Every change saves at once and the columns redraw.
 */
export function StageEditor({ pipeline = "deals", noun = "deal", stages, counts }: { pipeline?: AqPipeline; noun?: string; stages: string[]; counts: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState("");
  const router = useRouter();
  const run = (fn: () => Promise<R>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.reason);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary inline-flex items-center gap-1.5">
        <Settings2 size={14} /> Edit stages
      </button>
    );
  return (
    <div className="card w-full max-w-3xl p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold">Pipeline stages</div>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-xs">
          Done
        </button>
      </div>
      <ol className="divide-y divide-line">
        {stages.map((st, i) => (
          <li key={st} className="flex items-center gap-2 py-2">
            <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
            {editing === st ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => renameAqStage(pipeline, st, draft));
                }}
              >
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="input flex-1 py-1" />
                <button type="submit" disabled={pending} className="btn-primary px-3 py-1 text-xs">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className="btn-ghost text-xs">
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className={`chip text-[11px] ${aqDealStageTone(st)}`}>{st}</span>
                <span className="flex-1 text-xs text-muted">
                  {counts[st] ?? 0} {noun}{(counts[st] ?? 0) === 1 ? "" : "s"}
                </span>
                <button type="button" title="Rename" disabled={pending} onClick={() => { setEditing(st); setDraft(st); }} className="btn-ghost p-1">
                  <Pencil size={14} />
                </button>
                <button type="button" title="Move left" disabled={pending || i === 0} onClick={() => run(() => moveAqStage(pipeline, st, -1))} className="btn-ghost p-1 disabled:opacity-30">
                  <ChevronLeft size={14} />
                </button>
                <button type="button" title="Move right" disabled={pending || i === stages.length - 1} onClick={() => run(() => moveAqStage(pipeline, st, 1))} className="btn-ghost p-1 disabled:opacity-30">
                  <ChevronRight size={14} />
                </button>
                <button type="button" title={(counts[st] ?? 0) ? `Move its ${noun}s out first` : "Remove this stage"} disabled={pending || Boolean(counts[st])} onClick={() => run(() => deleteAqStage(pipeline, st))} className="btn-ghost p-1 text-red-700 disabled:opacity-30">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await addAqStage(pipeline, adding);
            if (r.ok) setAdding("");
            return r;
          });
        }}
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New stage name" className="input flex-1 py-1" />
        <button type="submit" disabled={pending || !adding.trim()} className="btn-primary inline-flex items-center gap-1 px-3 py-1 text-xs">
          <Plus size={14} /> Add stage
        </button>
      </form>
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      <div className="mt-2 text-[11px] text-muted">Renaming a stage carries its {noun}s with it. A stage can be removed once it is empty. The order here is the column order.</div>
    </div>
  );
}
