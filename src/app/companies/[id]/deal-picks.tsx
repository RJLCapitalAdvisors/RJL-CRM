"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { setDealPicksAction } from "../actions";

/**
 * Who at this firm gets the deal emails (Jonathan, Oct 8, 2026). The checkbox puts a person on every deal email the firm is
 * sent; the star makes the email addressed to them (their first name in the greeting). With nothing ticked the Send deal
 * page keeps choosing from the email log as before; a tick or a star overrides that for this firm.
 */
export function DealPicks({ contactId, send, address }: { contactId: string; send: boolean; address: boolean }) {
  const [on, setOn] = useState(send);
  const [star, setStar] = useState(address);
  const [, start] = useTransition();
  const save = (next: { send?: boolean; address?: boolean }) => start(async () => { await setDealPicksAction(contactId, next); });
  return (
    <span className="flex shrink-0 items-center gap-2">
      <label className="flex items-center gap-1 text-[11px] text-muted" title="Include this person on the firm's deal emails">
        <input type="checkbox" className="accent-ink" checked={on} onChange={(e) => { const v = e.target.checked; setOn(v); if (!v && star) setStar(false); save({ send: v, ...(v ? {} : { address: false }) }); }} />
        on deal emails
      </label>
      <button type="button" title={star ? "The deal emails are addressed to this person (click to unstar)" : "Address the firm's deal emails to this person"} onClick={() => { const v = !star; setStar(v); if (v && !on) setOn(true); save({ address: v, ...(v ? { send: true } : {}) }); }} className="rounded p-0.5 hover:bg-cream">
        <Star className={`h-4 w-4 ${star ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
      </button>
    </span>
  );
}
