"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ROLES } from "@/lib/taxonomy";
import { RoleChips } from "./ui";
import { setCompanyRoles } from "@/app/companies/actions";

/** Roles in a list row: click to tick, saves once when the list closes (or queues a proposal for Jonathan if you are not him). */
export function RoleCell({ companyId, roles }: { companyId: string; roles: string }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(() => JSON.parse(roles || "[]"));
  const saved = useRef<string[]>(JSON.parse(roles || "[]"));
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    const changed = sel.length !== saved.current.length || sel.some((x) => !saved.current.includes(x));
    if (!changed) return;
    saved.current = sel;
    start(async () => {
      const res = await setCompanyRoles(companyId, sel);
      setNote(res.proposed ? "sent to Jonathan" : "saved");
      setTimeout(() => setNote(null), 2000);
    });
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sel]);

  const toggle = (r: string) => setSel((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} className="flex min-h-[22px] items-center gap-1 rounded px-1 text-left hover:bg-cream" title="Click to change roles">
        {sel.length ? <RoleChips roles={JSON.stringify(sel)} /> : <span className="text-muted">—</span>}
        {note && <span className="ml-1 text-[10px] text-muted">{note}</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-44 rounded-md border border-line bg-paper p-2 shadow-lg">
          {ROLES.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-cream">
              <input type="checkbox" checked={sel.includes(r)} onChange={() => toggle(r)} className="accent-ink" />
              {r}
            </label>
          ))}
          <button type="button" className="mt-1 w-full rounded bg-ink px-2 py-1 text-xs text-white" onClick={close}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
