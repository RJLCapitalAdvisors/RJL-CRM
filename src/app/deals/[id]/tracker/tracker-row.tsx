"use client";

import { useState, useTransition } from "react";
import { TRACKER_STATUSES, statusOf } from "@/lib/tracker";
import { saveTrackerNote, setTrackerStatus } from "./actions";
import { GrowingTextarea } from "@/components/growing-textarea";

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

/** The note, edited right in the cell: type, and it saves itself a moment later. Dates go in the text the way the reports do, e.g. "Passed (Sep 1): …". */
export function NoteCell({ rowId, note }: { rowId: string; note: string | null }) {
  return (
    <GrowingTextarea
      defaultValue={note}
      placeholder="Add note"
      className="text-[10.5pt]"
      onSave={async (v) => {
        const fd = new FormData();
        fd.set("note", v);
        await saveTrackerNote(rowId, fd);
      }}
    />
  );
}
