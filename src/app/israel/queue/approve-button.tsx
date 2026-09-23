"use client";

import { useState, useTransition } from "react";
import { queueApprove, type QueueKind } from "../queue-actions";

/** Approve on a row of The Que. Complete data goes straight in; with data missing the row says where it went. */
export function QueueApprove({ kind, id, missing }: { kind: QueueKind; id: string; missing: number }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done) return <span className="text-xs text-emerald-700">{done}</span>;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className={`px-3 py-1 text-xs ${missing ? "btn-secondary" : "btn-primary"}`}
        title={missing ? `${missing} item${missing === 1 ? "" : "s"} still missing. Approving anyway asks Jonathan: it stays here marked waiting on him until he approves.` : "Data complete; into the system"}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await queueApprove(kind, id);
            if (!r.ok) setError(r.reason);
            else setDone(r.where === "system" ? "In the system" : "Waiting on Jonathan");
          })
        }
      >
        {pending ? "Approving…" : missing ? "Approve anyway" : "Approve"}
      </button>
      {error && <span className="text-[11px] text-red-700">{error}</span>}
    </div>
  );
}
