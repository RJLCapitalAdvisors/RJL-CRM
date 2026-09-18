"use client";

import { useState, useTransition } from "react";

/** The Email reading switch on a Users row: On or Off for this side, one click to flip, the reason shown if it cannot. */
export function MailReadToggle({ on, action, disabled = false }: { on: boolean; action: (on: boolean) => Promise<{ ok: true } | { ok: false; reason: string }>; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={pending || disabled}
        title={on ? "Turn email reading off for this side" : "Turn email reading on for this side"}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await action(!on);
            if (!r.ok) setError(r.reason);
          })
        }
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition ${on ? "border-emerald-600 bg-emerald-500" : "border-line bg-cream"} ${pending || disabled ? "opacity-50" : ""}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
      {error && <span className="text-[11px] text-red-700">{error}</span>}
    </div>
  );
}
