"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openFollowUp } from "./todo-actions";

/**
 * "Handle": builds the follow-up as a reply-all draft in your Outlook (original attachments re-attached,
 * Calibri 11, signature) and opens it in desktop Outlook. The LP stays on the list until that draft is sent.
 */
export function RespondNow({ rowId, draftOpen, disabled }: { rowId: string; draftOpen: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [webLink, setWebLink] = useState<string | null>(null);
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
          start(async () => {
            const r = await openFollowUp(rowId);
            if (!r.ok) return setError(r.reason);
            setWebLink(r.webLink);
            // desktop Outlook via the outlook: protocol; the web link stays available as a fallback
            window.location.href = r.outlookLink ?? r.webLink;
            router.refresh();
          });
        }}
      >
        {pending ? "Opening…" : draftOpen ? "Open draft" : "Handle"}
      </button>
      {webLink && (
        <a href={webLink} target="_blank" className="text-xs text-muted hover:underline" title="If desktop Outlook did not open the draft">
          open in Outlook web instead
        </a>
      )}
      {error && <span className="max-w-[220px] text-right text-xs text-red-700">{error}</span>}
    </div>
  );
}
