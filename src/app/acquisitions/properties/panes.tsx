"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DataGrid, type GridColumn, type GridRow } from "@/components/data-grid";
import { ZoomControls, useZoom } from "@/components/zoom-box";
import { aqRoleColor, aqStageTone } from "@/lib/acquisitions";
import { updateAqCell } from "../actions";

/**
 * The Properties sheet in three panes (Jonathan, Sep 22, 2026): the property itself, its owner, its operator. One row
 * per property across all three, so scrolling up and down moves them together; each pane scrolls sideways on its own.
 * Cells in the Owners and Operators panes edit the contact card behind them.
 */
export type PaneRows = { properties: GridRow[]; owners: GridRow[]; operators: GridRow[] };
export type PaneColumns = { properties: GridColumn[]; owners: GridColumn[]; operators: GridColumn[] };

const tone = (cols: GridColumn[]) => cols.map((c) => (c.key === "callResult" || c.key === "deal" ? { ...c, tone: aqStageTone } : c.key === "roles" ? { ...c, tone: aqRoleColor } : c));

export function PropertyPanes({ rows, columns }: { rows: PaneRows; columns: PaneColumns }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useZoom("aq-property-panes");
  const [epoch, setEpoch] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("grid-tools")), []);

  // the three windows can be widened or narrowed against each other: drag the divider between two panes (remembered here)
  const [shares, setShares] = useState<number[]>([3, 2, 2]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("grid:aq-panes:shares") ?? "null") as number[] | null;
      if (v && v.length === 3 && v.every((x) => x > 0)) setShares(v);
    } catch {
      /* default split */
    }
  }, []);
  const dragging = useRef<{ i: number; startX: number; start: number[]; width: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      const total = d.start.reduce((a, b) => a + b, 0);
      const perPx = total / d.width; // shares per pixel
      const delta = (e.clientX - d.startX) * perPx;
      const min = 260 * perPx;
      const left = Math.max(min, d.start[d.i] + delta);
      const right = Math.max(min, d.start[d.i + 1] - (left - d.start[d.i]));
      const next = [...d.start];
      next[d.i] = left;
      next[d.i + 1] = right;
      setShares(next);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = "";
      setShares((v) => {
        try {
          localStorage.setItem("grid:aq-panes:shares", JSON.stringify(v));
        } catch {
          /* private window */
        }
        return v;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  const divider = (i: number) => (
    <div
      key={`div-${i}`}
      role="separator"
      title="Drag to give this window more or less room"
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = { i, startX: e.clientX, start: shares, width: wrap.current?.clientWidth ?? 1200 };
        document.body.style.cursor = "col-resize";
      }}
      className="group flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
    >
      <div className="w-[3px] rounded bg-line group-hover:bg-sky-600" />
    </div>
  );

  // one vertical scroll for the three panes: whichever pane the wheel is over drives the other two
  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const boxes = Array.from(root.querySelectorAll<HTMLElement>("[data-grid-scroll]"));
    let driving: HTMLElement | null = null;
    let release: ReturnType<typeof setTimeout> | null = null;
    const handlers = boxes.map((b) => {
      const h = () => {
        if (driving && driving !== b) return;
        driving = b;
        for (const o of boxes) if (o !== b && o.scrollTop !== b.scrollTop) o.scrollTop = b.scrollTop;
        if (release) clearTimeout(release);
        release = setTimeout(() => (driving = null), 80);
      };
      b.addEventListener("scroll", h, { passive: true });
      return { b, h };
    });
    return () => handlers.forEach(({ b, h }) => b.removeEventListener("scroll", h));
  }, [epoch, rows]);

  const contactSave = (pane: GridRow[]) => async (rowId: string, key: string, value: string | null) => {
    const contactId = pane.find((r) => r.id === rowId)?.contactId as string | undefined;
    if (!contactId) return { ok: false as const, reason: "No contact linked to this property yet. Open the property and add one in its Owners or Operators window." };
    return updateAqCell("contact", contactId, key, value);
  };
  const tools = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="rounded-md border border-line bg-paper px-2 py-1 text-[11px] text-muted shadow-sm hover:bg-cream"
        title="Put every pane's columns back in their original order and width"
        onClick={() => {
          try {
            for (const k of ["grid:aq-pane-property", "grid:aq-pane-owner", "grid:aq-pane-operator", "grid:aq-panes:shares"]) localStorage.removeItem(k);
          } catch {
            /* nothing to clear */
          }
          setShares([3, 2, 2]);
          setEpoch((e) => e + 1);
        }}
      >
        Reset columns
      </button>
      <ZoomControls zoom={zoom} setZoom={setZoom} />
    </div>
  );
  const pane = (id: string, title: string, cols: GridColumn[], data: GridRow[], save: (rowId: string, key: string, value: string | null) => ReturnType<typeof updateAqCell>, linkKey: string, empty: string) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-paper">
      <DataGrid key={`${id}-${epoch}`} id={id} title={title} columns={tone(cols)} rows={data} save={save} empty={empty} linkKey={linkKey} zoom={zoom} onZoom={setZoom} showTools={false} />
    </div>
  );
  return (
    <>
      {slot && createPortal(tools, slot)}
      <div ref={wrap} className="flex h-full min-h-0 items-stretch">
        <div className="flex min-h-0 min-w-0" style={{ flex: `${shares[0]} 1 0px` }}>
          {pane("aq-pane-property", "Property", columns.properties, rows.properties, (id, k, v) => updateAqCell("property", id, k, v), "address", "No properties match.")}
        </div>
        {divider(0)}
        <div className="flex min-h-0 min-w-0" style={{ flex: `${shares[1]} 1 0px` }}>
          {pane("aq-pane-owner", "Owner", columns.owners, rows.owners, contactSave(rows.owners), "fullName", "No properties match.")}
        </div>
        {divider(1)}
        <div className="flex min-h-0 min-w-0" style={{ flex: `${shares[2]} 1 0px` }}>
          {pane("aq-pane-operator", "Operator", columns.operators, rows.operators, contactSave(rows.operators), "fullName", "No properties match.")}
        </div>
      </div>
    </>
  );
}
