"use client";

import { useState, useTransition } from "react";
import { TRACKER_STATUSES, statusOf } from "@/lib/tracker";
import { saveTrackerNote, setTrackerStatus } from "./actions";

export function StatusBadge({ rowId, status }: { rowId: string; status: number }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(status);
  const [, start] = useTransition();
  const st = statusOf(cur);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={{ background: st.bg, color: st.c }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: st.d }} />
        {st.label} ⌄
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-paper shadow-lg">
          {[...TRACKER_STATUSES].reverse().map((s) => (
            <button
              key={s.id}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-cream ${s.id === cur ? "bg-cream-50" : ""}`}
              style={{ color: s.id === 6 ? "#1e40af" : s.c }}
              onClick={() => {
                setCur(s.id);
                setOpen(false);
                start(() => setTrackerStatus(rowId, s.id));
              }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.d }} />
              {s.label}
              {s.id === cur ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NoteCell({ rowId, note, noteDate }: { rowId: string; note: string | null; noteDate: string | null }) {
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  if (editing) {
    return (
      <form
        action={(fd) => {
          setEditing(false);
          start(() => saveTrackerNote(rowId, fd));
        }}
        className="space-y-1"
      >
        <textarea name="note" defaultValue={note ?? ""} rows={2} autoFocus className="input text-xs" />
        <div className="flex gap-2">
          <button className="btn-primary px-2 py-1 text-xs" type="submit">
            Save
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div onClick={() => setEditing(true)} className="cursor-text">
      {note ? (
        <>
          <span className="text-xs italic leading-relaxed text-ink-soft">{note}</span>
          {noteDate && <div className="text-[10px] text-muted">Updated {noteDate}</div>}
        </>
      ) : (
        <span className="text-[11px] text-muted">Add note ✎</span>
      )}
    </div>
  );
}
