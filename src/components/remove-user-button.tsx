"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Remove a person from the CRM (Jonathan, Sep 18): both sides at once. Their sign-in stops working the moment it is
 * clicked (the session check requires an active user), their mailbox is no longer read, and they leave every team
 * list; their past activity stays on the records. First click asks, second click within ten seconds removes.
 */
export function RemoveUserButton({ action, name, self }: { action: () => Promise<{ ok: true } | { ok: false; reason: string }>; name: string; self: boolean }) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  if (self) return <span className="text-[11px] text-muted">you</span>;
  const live = armed != null && Date.now() - armed < 10_000;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        className={`px-2.5 py-1 text-xs ${live ? "btn-primary" : "btn-ghost text-red-700"}`}
        disabled={pending}
        title={`Remove ${name} from the CRM: no more sign-in, no more mailbox tracking, off every list. Their past activity stays.`}
        onClick={() => {
          setError(null);
          if (!live) return setArmed(Date.now());
          setArmed(null);
          start(async () => {
            const r = await action();
            if (!r.ok) return setError(r.reason);
            router.refresh();
          });
        }}
      >
        {pending ? "Removing…" : live ? `Remove ${name.split(" ")[0]}?` : "Remove"}
      </button>
      {live && <span className="text-[11px] text-muted">Click again to confirm</span>}
      {error && <span className="max-w-[240px] text-right text-[11px] text-red-700">{error}</span>}
    </div>
  );
}
