"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ilRoleColor } from "@/lib/israel";

/** Colored role tokens for RJL Israel companies and contacts. */
export function IlRoleChips({ roles, size = "text-[11px]" }: { roles: string | string[]; size?: string }) {
  const list = Array.isArray(roles) ? roles : safeList(roles);
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((r) => (
        <span key={r} className={`chip ${size} ${ilRoleColor(r)}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

const safeList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * Roles in a list row or a record header: click the tokens, tick what applies, and it saves once when the list
 * closes. Same behavior as the RJL Capital Advisors role cell. The action is bound to the record on the server.
 */
export function IlRoleCell({ roles, options, action, align = "left" }: { roles: string; options: readonly string[]; action: (roles: string[]) => Promise<void>; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(() => safeList(roles));
  const saved = useRef<string[]>(safeList(roles));
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSel(safeList(roles));
    saved.current = safeList(roles);
  }, [roles]);

  const close = () => {
    setOpen(false);
    const changed = sel.length !== saved.current.length || sel.some((x) => !saved.current.includes(x));
    if (!changed) return;
    saved.current = sel;
    start(async () => {
      await action(sel);
      setNote("saved");
      setTimeout(() => setNote(null), 1500);
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
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} className="flex min-h-[22px] items-center gap-1 rounded px-1 text-left hover:bg-cream" title="Click to change roles">
        {sel.length ? <IlRoleChips roles={sel} /> : <span className="rounded border border-dashed border-line px-2 py-0.5 text-[11px] text-muted">Set roles</span>}
        {note && <span className="ml-1 text-[10px] text-muted">{note}</span>}
      </button>
      {open && (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-1 w-48 rounded-md border border-line bg-paper p-2 shadow-lg`}>
          {options.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-cream">
              <input type="checkbox" checked={sel.includes(r)} onChange={() => toggle(r)} className="accent-ink" />
              <span className={`chip text-[11px] ${ilRoleColor(r)}`}>{r}</span>
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
