"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Send invite / Invite again, with an answer. The plain form before this gave no sign anything happened: on Sep 17
 * Jonathan clicked seven times and seven emails went to Shawn while the button looked dead. Now the button says
 * "Sending…", then "Sent to shawn@… at 11:48" (and stays quiet for a moment so a second click is deliberate), or shows
 * the reason it could not send.
 */
export type InviteResult = { ok: true; to: string } | { ok: false; reason: string };

export function InviteButton({ action, label, email }: { action: () => Promise<InviteResult>; label: string; email: string }) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        className="btn-grey px-2.5 py-1 text-xs"
        disabled={pending || Boolean(sent)}
        title={`Email ${email} the sign-in link`}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await action();
              if (!r.ok) return setError(r.reason);
              setSent(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
              setTimeout(() => setSent(null), 30_000);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        {pending ? "Sending…" : sent ? "Sent" : label}
      </button>
      {sent && <span className="text-[11px] text-emerald-700">Sent to {email} at {sent}</span>}
      {error && <span className="max-w-[260px] text-right text-[11px] text-red-700">{error}</span>}
    </div>
  );
}
