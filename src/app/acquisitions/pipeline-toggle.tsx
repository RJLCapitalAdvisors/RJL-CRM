"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { setAqPipeline, setAqPipelinePriority } from "./actions";

/**
 * One token on a contact card or a property ticket (Jonathan, Sep 24, 2026): "Send to pipeline" puts the record on its
 * pipeline list (Buyers, Operators or Deals) without moving it anywhere; once there, a 1 to 5 priority sits beside it
 * and "Remove" takes it off the list. The record stays where it always was.
 */
export function PipelineToggle({ kind, id, at, priority, compact = false }: { kind: "contact" | "property"; id: string; at: Date | string | null | undefined; priority: number | null | undefined; compact?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const inPipeline = Boolean(at);
  const since = at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  if (!inPipeline)
    return (
      <button type="button" disabled={pending} onClick={() => start(async () => { await setAqPipeline(kind, id, true); router.refresh(); })} className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:border-sky-600 hover:text-sky-700 ${compact ? "" : ""}`} title="Track this on its pipeline list as well; it stays here too">
        <Flag className="h-3.5 w-3.5" />
        {pending ? "Sending…" : "Send to pipeline"}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky px-3 py-1 font-medium text-ink" title={since ? `On the pipeline since ${since}` : "On the pipeline"}>
        <Flag className="h-3.5 w-3.5" />
        In pipeline{since && !compact ? ` · ${since}` : ""}
      </span>
      <label className="inline-flex items-center gap-1 text-muted">
        Priority
        <select value={priority ?? ""} disabled={pending} onChange={(e) => start(async () => { await setAqPipelinePriority(kind, id, e.target.value ? Number(e.target.value) : null); router.refresh(); })} className="input w-16 py-0.5 text-xs" title="1 to 5; the highest sit at the top of the pipeline list">
          <option value="">—</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={pending} onClick={() => start(async () => { await setAqPipeline(kind, id, false); router.refresh(); })} className="text-muted hover:text-red-700 hover:underline" title="Off the pipeline list; the record stays where it is">
        Remove
      </button>
    </span>
  );
}
