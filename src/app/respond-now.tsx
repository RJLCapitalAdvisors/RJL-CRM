"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markFollowedUp } from "./todo-actions";

/**
 * "Respond now": opens the follow-up in Outlook ("Hi Name - please confirm receipt.") and marks the
 * LP as Followed Up so they drop off the quiet list. Today this is a fresh email to the contact with
 * the deal's subject line as RE:. Once Microsoft 365 is connected it becomes a true reply-all on the
 * original sent email with the attachments re-attached.
 */
export function RespondNow({ rowId, href, disabled }: { rowId: string; href: string | null; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-primary shrink-0 px-2.5 py-1 text-xs disabled:opacity-40"
      disabled={disabled || !href || pending}
      title={href ? "Opens the follow-up in Outlook and marks this LP as Followed Up" : "No email address on file"}
      onClick={() => {
        if (!href) return;
        window.location.href = href;
        start(async () => {
          await markFollowedUp(rowId);
          router.refresh();
        });
      }}
    >
      Respond now
    </button>
  );
}
