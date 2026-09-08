"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Handle button: step 1 runs a server action that prepares a draft in your Outlook and returns links;
 * step 2 is a direct link (rjlcrm: bridge -> desktop Outlook, web as fallback). The direct click matters:
 * browsers only launch another app on a real user gesture.
 */
export type DraftLinks = { ok: true; webLink: string; outlookLink: string | null; messageId: string | null; replyTo?: { messageId: string; greeting: string; attachments: boolean } } | { ok: false; reason: string };
type Links = { outlookLink: string | null; webLink: string; messageId: string | null; replyTo?: { messageId: string; greeting: string; attachments: boolean } };
/** rjlcrm: is the small per-user link type (scripts/setup-outlook-link.ps1). reply = Outlook builds the reply-all itself from the original email; open = show a server draft. */
const desktopHref = (r: Links) => {
  if (r.replyTo) return `rjlcrm:reply?mid=${encodeURIComponent(r.replyTo.messageId)}&greet=${encodeURIComponent(r.replyTo.greeting)}&att=${r.replyTo.attachments ? 1 : 0}${r.messageId ? `&draft=${encodeURIComponent(r.messageId)}` : ""}${r.outlookLink ? `&eid=${r.outlookLink.replace(/^outlook:/, "")}` : ""}`;
  if (r.messageId) return `rjlcrm:open?mid=${encodeURIComponent(r.messageId)}${r.outlookLink ? `&eid=${r.outlookLink.replace(/^outlook:/, "")}` : ""}`;
  return r.outlookLink ?? r.webLink;
};

export function DraftButton({ label = "Handle", readyLabel = "Open in Outlook", action, disabled, title }: { label?: string; readyLabel?: string; action: () => Promise<DraftLinks>; disabled?: boolean; title?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Extract<DraftLinks, { ok: true }> | null>(null);
  const router = useRouter();
  if (ready) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <a href={desktopHref(ready)} className="btn-primary" title="Opens the draft in desktop Outlook">
          {readyLabel}
        </a>
        <span className="text-[11px] text-muted">If it did not pop up, click the button</span>
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
        title={title}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await action();
            if (!r.ok) return setError(r.reason);
            setReady(r);
            // try to pop it open right away (works once the browser has been told to always allow RJL CRM links);
            // the Open in Outlook button below is the sure thing if the browser insists on a direct click
            try {
              window.location.href = desktopHref(r);
            } catch {
              /* ignore */
            }
            router.refresh();
          });
        }}
      >
        {pending ? "Preparing draft…" : label}
      </button>
      {error && <span className="max-w-[220px] text-right text-xs text-red-700">{error}</span>}
    </div>
  );
}
