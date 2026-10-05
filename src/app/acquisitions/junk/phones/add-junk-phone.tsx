"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { junkAqPhoneByHand } from "../../junk-actions";

/** Type a number to junk it without finding the contact first; it comes off every contact that carries it. */
export function AddJunkPhone() {
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="card flex flex-wrap items-center gap-2 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await junkAqPhoneByHand(phone, reason || null);
          setMsg(r.ok ? `Junked. It came off ${r.removedFrom} contact${r.removedFrom === 1 ? "" : "s"}.` : r.reason);
          if (r.ok) {
            setPhone("");
            setReason("");
            router.refresh();
          }
        });
      }}
    >
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Number to junk, e.g. (718) 555-0100" className="input w-64" />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional)" className="input flex-1 min-w-[200px]" />
      <button type="submit" disabled={pending || !phone.trim()} className="btn-secondary px-3 text-xs">
        {pending ? "Junking…" : "Send to junk"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </form>
  );
}
