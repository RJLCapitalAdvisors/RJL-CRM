"use client";

import { useRef, useState, useTransition } from "react";
import { setRentAction } from "./actions";

/** One rent in the table: click, type the shekels a month, Enter or click away saves; a small "saved" shows for a moment. */
export function RentCell({ rentId, value }: { rentId: string; value: number | null }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value == null ? "" : String(value));
  const saved = useRef(value == null ? "" : String(value));
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();

  const commit = () => {
    setEditing(false);
    const next = val.replace(/[^0-9]/g, "");
    setVal(next);
    if (next === saved.current) return;
    saved.current = next;
    start(async () => {
      const r = await setRentAction(rentId, "rentNis", next || null);
      setNote(r.ok ? "saved" : r.reason);
      setTimeout(() => setNote(null), r.ok ? 1800 : 4000);
    });
  };
  if (editing) {
    return (
      <input
        autoFocus
        inputMode="numeric"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setVal(saved.current); setEditing(false); }
        }}
        className="input w-28 py-0.5 text-right text-sm"
        placeholder="₪ a month"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="flex w-full min-w-[7rem] items-center justify-end gap-2 rounded px-1 py-0.5 text-right hover:bg-cream" title="Click to type the asking rent, in shekels a month">
      {note && <span className={`text-[10px] ${note === "saved" ? "text-muted" : "text-red-700"}`}>{note}</span>}
      <span className={val ? "tabular-nums" : "text-muted"}>{val ? `₪${Number(val).toLocaleString("en-US")}` : "—"}</span>
    </button>
  );
}
