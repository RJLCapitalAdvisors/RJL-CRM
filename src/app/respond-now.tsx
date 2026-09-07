"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openFollowUp } from "./todo-actions";

/**
 * "Respond now": builds the follow-up as a reply-all draft in Outlook (original attachments re-attached,
 * Calibri 11, signature) and opens it in a new tab. The LP stays on the list until that draft is sent.
 */
export function RespondNow({ rowId, draftOpen, disabled }: { rowId: string; draftOpen: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        className="btn-soft"
        disabled={disabled || pending}
        title={draftOpen ? "A draft is already waiting in Outlook. Opens it again." : "Creates the reply-all in Outlook with the original attachments and opens it"}
        onClick={() => {
          setError(null);
          const tab = window.open("", "_blank"); // open synchronously so the browser does not block it
          start(async () => {
            const r = await openFollowUp(rowId);
            if (r.ok) {
              if (tab) tab.location.href = r.webLink;
              else window.open(r.webLink, "_blank");
              router.refresh();
            } else {
              tab?.close();
              setError(r.reason);
            }
          });
        }}
      >
        {pending ? "Opening…" : draftOpen ? "Open draft" : "Respond now"}
      </button>
      {error && <span className="max-w-[220px] text-right text-xs text-red-700">{error}</span>}
    </div>
  );
}
