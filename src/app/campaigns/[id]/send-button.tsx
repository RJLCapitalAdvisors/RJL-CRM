"use client";

import { useState, useTransition } from "react";

export function SendButton({ action, pending, configured }: { action: () => Promise<{ sent: number; failed: number }>; pending: number; configured: boolean }) {
  const [busy, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (pending === 0) return <span className="text-sm text-muted">Nothing pending</span>;
  if (!configured) {
    return (
      <button className="btn-primary" disabled title="Add RESEND_API_KEY and MAIL_FROM to .env">
        Send to {pending}
      </button>
    );
  }
  if (!confirm) {
    return (
      <button className="btn-primary" onClick={() => setConfirm(true)}>
        Send to {pending}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {result && <span className="text-sm">{result}</span>}
      <button className="btn-secondary" onClick={() => setConfirm(false)} disabled={busy}>
        Cancel
      </button>
      <button
        className="btn-primary"
        disabled={busy}
        onClick={() =>
          start(async () => {
            try {
              const r = await action();
              setResult(`Sent ${r.sent}, failed ${r.failed}`);
            } catch (e) {
              setResult(String(e));
            }
            setConfirm(false);
          })
        }
      >
        {busy ? "Sending…" : `Yes, send ${pending} emails now`}
      </button>
    </span>
  );
}
