"use client";

import { useEffect, useRef, useState } from "react";
import { DraftButton } from "@/app/draft-button";
import { searchContactsForDeal, sendDealToOneAction } from "../actions";

type Person = { id: string; name: string; email: string; company: string | null };

/**
 * Send to one person: after launch an LP on a call asks to see the deal. Type a name, pick the person, and the
 * deal email (the General one from Send deal, with their first name) is drafted in your Outlook with the
 * attachments on, ready for you to click send.
 */
export function SendToOne({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setRows([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => searchContactsForDeal(q).then((r) => live && setRows(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  return (
    <div ref={box} className="relative">
      <button type="button" className="btn-secondary" onClick={() => setOpen((o) => !o)} title="Draft the deal email to one person in your Outlook, attachments on, ready to send">
        Send to one person
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-line bg-paper p-3 shadow-lg">
          {picked ? (
            <div className="space-y-2 text-sm">
              <div>
                <div className="font-medium">{picked.name}</div>
                <div className="text-xs text-muted">
                  {picked.email}
                  {picked.company ? ` · ${picked.company}` : ""}
                </div>
              </div>
              <div className="text-xs text-muted">The deal email with the attachments opens as a draft in your Outlook. Send it from there; the report marks them Deal Sent once it goes.</div>
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="text-xs text-muted hover:underline" onClick={() => setPicked(null)}>
                  Pick someone else
                </button>
                <DraftButton label="Draft in Outlook" action={() => sendDealToOneAction(dealId, picked.id)} />
              </div>
            </div>
          ) : (
            <>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or firm" className="input" />
              <ul className="mt-2 max-h-64 divide-y divide-line overflow-auto text-sm">
                {rows.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="w-full px-2 py-1.5 text-left hover:bg-cream" onClick={() => setPicked(p)}>
                      <div className="font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted">
                        {p.email}
                        {p.company ? ` · ${p.company}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
                {q.trim().length >= 2 && rows.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">Nobody with an email matches.</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
