"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshReportAction } from "./actions";

/** Refresh report: pull the latest mail, re-read every response, check for intro calls, rewrite the themes and items, then redraw the page. */
export function RefreshButton({ dealId }: { dealId: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="btn-primary inline-flex items-center gap-1.5"
        title="Read the mailboxes again, update statuses, notes and requests, look for intro calls, and rewrite the themes and items"
        onClick={() =>
          start(async () => {
            setNote(null);
            const r = await refreshReportAction(dealId);
            setNote(r.ok ? `Updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${r.linked ? ` · ${r.linked} new email${r.linked === 1 ? "" : "s"} tied to the deal` : ""}${r.moved ? ` · ${r.moved} row${r.moved === 1 ? "" : "s"} moved` : ""}` : r.reason);
            router.refresh();
          })
        }
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Refreshing…" : "Refresh report"}
      </button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}
