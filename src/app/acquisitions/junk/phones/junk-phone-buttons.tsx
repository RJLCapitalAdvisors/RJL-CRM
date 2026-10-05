"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { forgetJunkPhone, restoreJunkPhone } from "../../junk-actions";

/** Restore puts the number back on its contact and off the list; Forget only drops it from the list. */
export function JunkPhoneButtons({ id, hasContact }: { id: string; hasContact: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-3 text-xs">
      {error && <span className="text-red-700">{error}</span>}
      <button
        type="button"
        disabled={pending}
        className="text-sky-700 hover:underline"
        title={hasContact ? "Back on the contact it came off, in the field it was in" : "Off the junk list; there is no contact to put it back on"}
        onClick={() =>
          start(async () => {
            const r = await restoreJunkPhone(id);
            if (!r.ok) setError(r.reason);
            else router.refresh();
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      <button
        type="button"
        disabled={pending}
        className="text-muted hover:underline"
        title="Off the junk list; the number is not put back on anyone and may be typed again"
        onClick={() =>
          start(async () => {
            await forgetJunkPhone(id);
            router.refresh();
          })
        }
      >
        Forget
      </button>
    </span>
  );
}
