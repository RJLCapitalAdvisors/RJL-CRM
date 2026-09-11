"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IL_SPONSOR, IL_SPONSOR_FOCUS, ilRoleColor } from "@/lib/israel";

/** Colored role tokens for RJL Israel companies and contacts. A sponsor's token carries its focus (development, acquisitions, both). */
export function IlRoleChips({ roles, focus, size = "text-[11px]" }: { roles: string | string[]; focus?: string | null; size?: string }) {
  const list = Array.isArray(roles) ? roles : safeList(roles);
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((r) => (
        <span key={r} className={`chip ${size} ${ilRoleColor(r)}`}>
          {r}
          {r === IL_SPONSOR && focus ? <span className="ml-1 opacity-70">· {focus}</span> : null}
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
 * closes. Same behavior as the RJL Capital Advisors role cell. Ticking Sponsor (Yazam) opens the focus question
 * (development, acquisitions or both) right under it. The action is bound to the record on the server.
 */
export function IlRoleCell({ roles, focus: f0 = null, options, action, align = "left" }: { roles: string; focus?: string | null; options: readonly string[]; action: (roles: string[], focus: string | null) => Promise<void>; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(() => safeList(roles));
  const [focus, setFocus] = useState<string | null>(f0);
  const saved = useRef<{ roles: string[]; focus: string | null }>({ roles: safeList(roles), focus: f0 });
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSel(safeList(roles));
    setFocus(f0);
    saved.current = { roles: safeList(roles), focus: f0 };
  }, [roles, f0]);

  const close = () => {
    setOpen(false);
    const nextFocus = sel.includes(IL_SPONSOR) ? focus : null;
    const changed = sel.length !== saved.current.roles.length || sel.some((x) => !saved.current.roles.includes(x)) || nextFocus !== saved.current.focus;
    if (!changed) return;
    saved.current = { roles: sel, focus: nextFocus };
    start(async () => {
      await action(sel, nextFocus);
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
  }, [open, sel, focus]);

  const toggle = (r: string) => setSel((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const showFocus = options.includes(IL_SPONSOR) && sel.includes(IL_SPONSOR);

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} className="flex min-h-[22px] items-center gap-1 rounded px-1 text-left hover:bg-cream" title="Click to change roles">
        {sel.length ? <IlRoleChips roles={sel} focus={sel.includes(IL_SPONSOR) ? focus : null} /> : <span className="rounded border border-dashed border-line px-2 py-0.5 text-[11px] text-muted">Set roles</span>}
        {note && <span className="ml-1 text-[10px] text-muted">{note}</span>}
      </button>
      {open && (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-1 w-56 rounded-md border border-line bg-paper p-2 shadow-lg`}>
          {options.map((r) => (
            <div key={r}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-cream">
                <input type="checkbox" checked={sel.includes(r)} onChange={() => toggle(r)} className="accent-ink" />
                <span className={`chip text-[11px] ${ilRoleColor(r)}`}>{r}</span>
              </label>
              {r === IL_SPONSOR && showFocus && (
                <div className="ml-6 mb-1 mt-0.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Development, acquisitions or both?</div>
                  <div className="flex flex-wrap gap-1">
                    {IL_SPONSOR_FOCUS.map((o) => (
                      <button key={o} type="button" onClick={() => setFocus(o)} className={`chip cursor-pointer text-[11px] ${focus === o ? "bg-ink text-white" : "border border-dashed border-line bg-transparent text-muted hover:text-ink"}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="mt-1 w-full rounded bg-ink px-2 py-1 text-xs text-white" onClick={close}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
