"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { ZoomControls, useZoom } from "@/components/zoom-box";

/**
 * An Excel-like grid for a CRM list (Jonathan, Sep 18, 2026): drag a header left or right to reorder the columns,
 * pull a header's right edge to widen or narrow it, scroll sideways to see every field the ticket has, and click any
 * cell to edit it in place (Enter or clicking away saves, Escape cancels, Tab moves to the next cell). Order and
 * widths are remembered in this browser per grid.
 */
export type GridOption = { value: string; label: string; domain?: string | null };
export type GridType = "text" | "multiline" | "number" | "money" | "date" | "select" | "tokens" | "tel" | "email" | "url" | "lines" | "readonly";
export type GridColumn = { key: string; label: string; type: GridType; options?: readonly (string | GridOption)[]; width?: number; tone?: (v: string) => string; hint?: string; logoKey?: string };
export type GridRow = { id: string; href?: string } & Record<string, unknown>;
export type SaveResult = { ok: true; row?: Record<string, unknown> } | { ok: false; reason: string };

const DEFAULT_WIDTH: Record<GridType, number> = { text: 160, multiline: 220, number: 100, money: 120, date: 120, select: 140, tokens: 170, tel: 130, email: 200, url: 180, lines: 200, readonly: 140 };
const MIN_WIDTH = 60;

const opt = (o: string | GridOption): GridOption => (typeof o === "string" ? { value: o, label: o } : o);
const fmtDate = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const toDateInput = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const money = (v: unknown) => (v == null || v === "" ? "" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim().startsWith("[") ? (JSON.parse(v) as string[]) : typeof v === "string" && v ? v.split(/\r?\n/).filter(Boolean) : []);

function Display({ col, value, row }: { col: GridColumn; value: unknown; row?: GridRow }) {
  if (col.type === "tokens" && asList(value).length === 0) return <span className="rounded border border-dashed border-line px-2 py-0.5 text-[11px] text-muted">Set {col.label.toLowerCase()}</span>;
  if (value == null || value === "") return <span className="text-muted">—</span>;
  if (col.logoKey && (col.type === "text" || col.type === "select")) {
    const o = col.type === "select" ? col.options?.map(opt).find((x) => x.value === String(value)) : null;
    const label = o?.label ?? String(value);
    const domain = (o?.domain ?? (row?.[col.logoKey] as string | null | undefined)) || null;
    return (
      <span className="inline-flex max-w-full items-center gap-2 align-middle">
        <CompanyLogo domain={domain} name={label} size={18} />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  switch (col.type) {
    case "money":
      return <span className="tabular-nums">{money(value)}</span>;
    case "number":
      return <span className="tabular-nums">{Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>;
    case "date":
    case "readonly":
      return <>{col.type === "date" || /^\d{4}-\d{2}-\d{2}T/.test(String(value)) ? fmtDate(value) : String(value)}</>;
    case "select": {
      const label = col.options?.map(opt).find((o) => o.value === String(value))?.label ?? String(value);
      return col.tone ? <span className={`chip text-[11px] ${col.tone(String(value))}`}>{label}</span> : <>{label}</>;
    }
    case "tokens":
      return (
        <span className="flex gap-1 overflow-hidden">
          {asList(value).map((t) => (
            <span key={t} className={`chip text-[11px] ${col.tone ? col.tone(t) : "bg-cream text-ink"}`}>
              {t}
            </span>
          ))}
        </span>
      );
    case "lines":
      return <>{asList(value).join("  •  ")}</>;
    case "url":
      return (
        <a href={/^https?:/i.test(String(value)) ? String(value) : `https://${value}`} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      );
    default:
      return <>{String(value).replace(/\s*\n\s*/g, "  ·  ")}</>;
  }
}

/** A read-only cell opened by a click: the whole text, lines kept, closes on Escape or a click elsewhere. */
function Peek({ col, value, onClose }: { col: GridColumn; value: unknown; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const text = col.type === "lines" ? asList(value).map((l) => `• ${l}`).join("\n") : String(value ?? "");
  return (
    <div ref={ref} tabIndex={-1} onBlur={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()} className="absolute left-0 top-0 z-30 max-h-80 min-w-[260px] max-w-[480px] overflow-auto whitespace-pre-line rounded-md border border-line bg-paper p-3 text-[13px] leading-relaxed shadow-lg outline-none">
      {text || <span className="text-muted">Nothing here</span>}
    </div>
  );
}

/** The in-cell editor. Commits a string (JSON for tokens) or null. */
function Editor({ col, value, onCommit, onCancel, onTab }: { col: GridColumn; value: unknown; onCommit: (v: string | null) => void; onCancel: () => void; onTab: (back: boolean) => void }) {
  const initial = col.type === "tokens" ? JSON.stringify(asList(value)) : col.type === "lines" ? asList(value).join("\n") : col.type === "date" ? toDateInput(value) : value == null ? "" : String(value);
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement && ref.current.type === "text") ref.current.select();
  }, []);
  const commit = (val = v) => onCommit(val.trim() === "" ? null : val);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit();
      onTab(e.shiftKey);
    } else if (e.key === "Enter" && !(col.type === "multiline" || col.type === "lines") ) {
      e.preventDefault();
      commit();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      commit();
    }
  };
  const cls = "input w-full py-0.5 text-[13px]";
  if (col.type === "tokens") {
    const chosen = new Set(JSON.parse(v || "[]") as string[]);
    const toggle = (t: string) => {
      const next = new Set(chosen);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      setV(JSON.stringify([...next]));
    };
    return (
      <div
        className="absolute left-0 top-0 z-30 min-w-[180px] rounded-md border border-line bg-paper p-2 shadow-lg"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") commit();
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) commit();
        }}
      >
        {(col.options ?? []).map(opt).map((o, i) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-cream">
            <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} autoFocus={i === 0} className="accent-ink" />
            <span className={`chip text-[11px] ${col.tone ? col.tone(o.value) : "bg-cream text-ink"}`}>{o.label}</span>
          </label>
        ))}
        <button type="button" className="mt-1 w-full rounded bg-ink px-2 py-1 text-xs text-white" onClick={() => commit()}>
          Done
        </button>
      </div>
    );
  }
  if (col.type === "select")
    return (
      <select ref={ref as React.RefObject<HTMLSelectElement>} value={v} onChange={(e) => { setV(e.target.value); onCommit(e.target.value === "" ? null : e.target.value); }} onBlur={() => commit()} onKeyDown={keys} className={cls}>
        <option value="">—</option>
        {(col.options ?? []).map(opt).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (col.type === "multiline" || col.type === "lines")
    return <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} value={v} rows={Math.min(8, Math.max(3, v.split("\n").length + 1))} onChange={(e) => setV(e.target.value)} onBlur={() => commit()} onKeyDown={keys} placeholder={col.type === "lines" ? "One per line" : ""} className={`${cls} absolute left-0 top-0 z-30 min-w-[260px] resize shadow-lg`} />;
  const type = col.type === "date" ? "date" : col.type === "number" || col.type === "money" ? "text" : col.type === "email" ? "email" : col.type === "tel" ? "tel" : col.type === "url" ? "url" : "text";
  return <input ref={ref as React.RefObject<HTMLInputElement>} type={type} value={v} inputMode={col.type === "number" || col.type === "money" ? "decimal" : undefined} onChange={(e) => setV(e.target.value)} onBlur={() => commit()} onKeyDown={keys} className={cls} />;
}

/** `linkKey` names the one column that opens the ticket instead of editing (the name); with it there is no separate open-arrow column. */
export function DataGrid({ id, columns, rows: initialRows, save, empty = "Nothing here.", linkKey }: { id: string; columns: GridColumn[]; rows: GridRow[]; save: (rowId: string, key: string, value: string | null) => Promise<SaveResult>; empty?: string; linkKey?: string }) {
  const storageKey = `grid:${id}`;
  const [order, setOrder] = useState<string[]>(columns.map((c) => c.key));
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(null);
  const [peek, setPeek] = useState<{ rowId: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [, start] = useTransition();
  const [zoom, setZoom] = useZoom(id);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setToolsSlot(document.getElementById("grid-tools")), []);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => setRows(initialRows), [initialRows]);
  // remembered order and widths (this browser only); columns that no longer exist drop out, new ones go to the end
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { order?: string[]; widths?: Record<string, number> } | null;
      if (saved?.order) {
        const known = new Set(columns.map((c) => c.key));
        const kept = saved.order.filter((k) => known.has(k));
        setOrder([...kept, ...columns.map((c) => c.key).filter((k) => !kept.includes(k))]);
      }
      if (saved?.widths) setWidths(saved.widths);
    } catch {
      /* nothing remembered */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const remember = (o: string[], w: Record<string, number>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ order: o, widths: w }));
    } catch {
      /* private window */
    }
  };

  const byKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);
  const ordered = order.map((k) => byKey[k]).filter(Boolean);
  const widthOf = (c: GridColumn) => widths[c.key] ?? c.width ?? DEFAULT_WIDTH[c.type];
  const total = ordered.reduce((a, c) => a + widthOf(c), 0) + (linkKey ? 0 : 36);

  // reorder by dragging a header
  const drop = (target: string) => {
    if (!dragKey || dragKey === target) return;
    const next = order.filter((k) => k !== dragKey);
    next.splice(next.indexOf(target), 0, dragKey);
    setOrder(next);
    remember(next, widths);
    setDragKey(null);
    setDropKey(null);
  };

  // resize by pulling the header's right edge
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      setWidths((w) => ({ ...w, [r.key]: Math.max(MIN_WIDTH, r.startW + (e.clientX - r.startX) / zoom) }));
    };
    const up = () => {
      if (!resizing.current) return;
      resizing.current = null;
      document.body.style.cursor = "";
      setWidths((w) => {
        remember(order, w);
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, zoom]);

  const editable = (c: GridColumn) => c.type !== "readonly" && c.key !== linkKey;
  const commit = (rowId: string, key: string, value: string | null) => {
    setEditing(null);
    const row = rows.find((r) => r.id === rowId);
    const col = byKey[key];
    if (!row || !col) return;
    const before = row[key];
    const beforeStr = col.type === "tokens" ? JSON.stringify(asList(before)) : col.type === "lines" ? asList(before).join("\n") : col.type === "date" ? toDateInput(before) : before == null ? null : String(before);
    if ((beforeStr ?? null) === (value ?? null)) return;
    // show it at once, then save; a refusal puts the old value back
    const optimistic = col.type === "tokens" ? asList(value ?? "[]") : col.type === "number" || col.type === "money" ? (value == null ? null : Number(value.replace(/[^0-9.-]/g, ""))) : value;
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, [key]: optimistic } : r)));
    setError(null);
    start(async () => {
      const res = await save(rowId, key, value);
      if (!res.ok) {
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, [key]: before } : r)));
        setError(res.reason);
      } else if (res.row) setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...res.row } : r)));
    });
  };
  const moveEdit = (rowId: string, key: string, back: boolean) => {
    const keys = ordered.filter(editable).map((c) => c.key);
    const i = keys.indexOf(key);
    const next = keys[i + (back ? -1 : 1)];
    if (next) setTimeout(() => setEditing({ rowId, key: next }), 0);
  };

  const tools = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="rounded-md border border-line bg-paper px-2 py-1 text-[11px] text-muted shadow-sm hover:bg-cream"
        title="Put the columns back in their original order and width"
        onClick={() => {
          setOrder(columns.map((c) => c.key));
          setWidths({});
          remember(columns.map((c) => c.key), {});
        }}
      >
        Reset columns
      </button>
      <ZoomControls zoom={zoom} setZoom={setZoom} />
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-800">{error}</div>}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {toolsSlot ? (
          createPortal(tools, toolsSlot)
        ) : (
          <div className="pointer-events-none sticky top-0 z-30 flex justify-end pr-2" style={{ height: 0 }}>
            <div className="pointer-events-auto mt-1">{tools}</div>
          </div>
        )}
        <table className="table dense grid-table" style={{ width: total, minWidth: "100%", tableLayout: "fixed", zoom }}>
          <colgroup>
            {!linkKey && <col style={{ width: 36 }} />}
            {ordered.map((c) => (
              <col key={c.key} style={{ width: widthOf(c) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              {!linkKey && <th className="bg-cream" title="Click a cell to edit; Enter saves, Escape cancels, Tab moves right. Drag a header to reorder, pull its edge to resize (double-click resets). Your layout is remembered on this computer." />}
              {ordered.map((c) => (
                <th
                  key={c.key}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(c.key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dropKey !== c.key) setDropKey(c.key);
                  }}
                  onDragLeave={() => dropKey === c.key && setDropKey(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(c.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setDropKey(null);
                  }}
                  title={c.hint ?? "Drag to move this column; pull the right edge to resize"}
                  className={`relative select-none bg-cream ${dropKey === c.key && dragKey !== c.key ? "border-l-2 border-l-sky-600" : ""} ${dragKey === c.key ? "opacity-50" : ""}`}
                >
                  <span className="flex cursor-grab items-center gap-1 overflow-hidden whitespace-nowrap active:cursor-grabbing">
                    <GripVertical className="h-3 w-3 shrink-0 text-muted/60" />
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span
                    draggable={false}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      resizing.current = { key: c.key, startX: e.clientX, startW: widthOf(c) };
                      document.body.style.cursor = "col-resize";
                    }}
                    onDoubleClick={() => {
                      const w = { ...widths };
                      delete w[c.key];
                      setWidths(w);
                      remember(order, w);
                    }}
                    className="absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize hover:bg-sky-600/40"
                    title="Pull to resize; double-click to reset"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={ordered.length + (linkKey ? 0 : 1)} className="py-10 text-center text-muted">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                {!linkKey && (
                  <td className="!px-1 text-center">
                    {r.href && (
                      <Link href={r.href} className="text-xs text-muted hover:text-sky-700" title="Open the ticket">
                        Open
                      </Link>
                    )}
                  </td>
                )}
                {ordered.map((c) => {
                  const on = editing?.rowId === r.id && editing.key === c.key;
                  const open = peek?.rowId === r.id && peek.key === c.key;
                  return (
                    <td
                      key={c.key}
                      onClick={() => {
                        if (c.key === linkKey) return;
                        if (editable(c)) {
                          if (!on) setEditing({ rowId: r.id, key: c.key });
                        } else if (r[c.key] != null && r[c.key] !== "" && !open) setPeek({ rowId: r.id, key: c.key });
                      }}
                      title={!on && !open && r[c.key] != null && r[c.key] !== "" && typeof r[c.key] === "string" && (r[c.key] as string).length > 24 ? "Click to open" : undefined}
                      className={`relative h-9 align-middle ${c.key === linkKey ? "" : editable(c) ? "cursor-text" : r[c.key] != null && r[c.key] !== "" ? "cursor-pointer text-muted" : "text-muted"} ${on ? "!p-0.5" : ""}`}
                      style={{ maxWidth: widthOf(c) }}
                    >
                      {c.key === linkKey && r.href ? (
                        <Link href={r.href} className="block truncate font-medium hover:underline" title="Open the ticket">
                          <Display col={c} value={r[c.key]} row={r} />
                        </Link>
                      ) : on ? (
                        <Editor col={c} value={r[c.key]} onCommit={(v) => commit(r.id, c.key, v)} onCancel={() => setEditing(null)} onTab={(back) => moveEdit(r.id, c.key, back)} />
                      ) : (
                        <div className="truncate">
                          <Display col={c} value={r[c.key]} row={r} />
                        </div>
                      )}
                      {open && <Peek col={c} value={r[c.key]} onClose={() => setPeek(null)} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
