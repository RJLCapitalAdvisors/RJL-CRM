"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openFollowUp } from "./todo-actions";

/**
 * "Handle": step 1 builds the follow-up as a reply-all draft in your Outlook (original attachments
 * re-attached, Calibri 11, signature). Step 2 is a plain link that opens it in desktop Outlook; it has
 * to be a direct click because browsers only launch another app on a real user gesture.
 * The LP stays on the list until that draft is actually sent.
 */
type Ready = { outlookLink: string | null; webLink: string; messageId: string | null };
/** rjlcrm: is a small per-user link type (scripts/setup-outlook-link.ps1) that opens the draft in desktop Outlook by Message-ID. */
const desktopHref = (r: Ready) => (r.messageId ? `rjlcrm:open?mid=${encodeURIComponent(r.messageId)}` : r.outlookLink ?? r.webLink);

export function RespondNow({ rowId, draftOpen, disabled }: { rowId: string; draftOpen: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const router = useRouter();

  if (ready) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <a href={desktopHref(ready)} className="btn-primary" title="Opens the draft in desktop Outlook">
          Open in Outlook
        </a>
        <a href={ready.webLink} target="_blank" className="text-xs text-muted hover:underline">
          or open in Outlook web
        </a>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        className="btn-soft"
        disabled={disabled || pending}
        title={draftOpen ? "A draft is already waiting in Outlook. Get the link to open it." : "Creates the reply-all in Outlook with the original attachments"}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await openFollowUp(rowId);
            if (!r.ok) return setError(r.reason);
            setReady({ outlookLink: r.outlookLink, webLink: r.webLink, messageId: r.messageId });
            router.refresh();
          });
        }}
      >
        {pending ? "Preparing draft…" : draftOpen ? "Open draft" : "Handle"}
      </button>
      {error && <span className="max-w-[220px] text-right text-xs text-red-700">{error}</span>}
    </div>
  );
}
