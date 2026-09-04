"use client";

import { useState, useTransition } from "react";
import { TRACKER_STATUSES, statusOf } from "@/lib/tracker";
import { saveTrackerNote, setTrackerStatus } from "./actions";

/** Status text inside the (already colored) table cell; click to change. */
export function StatusBadge({ rowId, status }: { rowId: string; status: number }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(status);
  const [, start] = useTransition();
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="block w-full text-left" style={{ color: statusOf(cur).c }} title="Change status">
        {statusOf(cur).label} <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-64 overflow-hidden border border-black bg-white shadow-lg">
          {[...TRACKER_STATUSES].reverse().map((s) => (
            <button
              key={s.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[10.5pt] hover:brightness-95"
              style={{ background: s.bg, color: s.c }}
              onClick={() => {
                setCur(s.id);
                setOpen(false);
                start(() => setTrackerStatus(rowId, s.id));
              }}
            >
              {s.label}
              {s.id === cur ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Note text; click to edit. Put the date in the text the way the reports do, e.g. "Passed (Sep 1): …". */
export function NoteCell({ rowId, note }: { rowId: string; note: string | null }) {
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
        <textarea name="note" defaultValue={note ?? ""} rows={3} autoFocus className="w-full border border-black p-1 text-[10.5pt]" style={{ fontFamily: "inherit" }} />
        <div className="flex gap-2 text-[9pt]">
          <button className="border border-black bg-black px-2 py-0.5 text-white" type="submit">
            Save
          </button>
          <button className="border border-black px-2 py-0.5" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div onClick={() => setEditing(true)} className="min-h-[1.2em] cursor-text whitespace-pre-wrap" title="Click to edit">
      {note || <span style={{ color: "#999" }}>Add note</span>}
    </div>
  );
}
