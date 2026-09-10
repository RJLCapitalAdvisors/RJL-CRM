"use client";

import { useId, useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DEAL_STAGES } from "@/lib/taxonomy";

// Deal Lost sits first so dead deals are parked at the front and the live pipeline reads left to right after it.
const BOARD_ORDER = ["Deal Lost", ...DEAL_STAGES.filter((s) => s !== "Deal Lost")];
import { fmtDate, fmtMoney } from "@/lib/format";
import { moveDeal } from "./actions";

export type BoardDeal = {
  id: string;
  name: string;
  stage: string;
  sponsorName: string | null;
  propertyName: string | null;
  city: string | null;
  state: string | null;
  assetClass: string | null;
  requestType: string | null;
  requestedAmount: number | null;
  closeDate: string | null;
  updatedAt: string;
  ownerName: string | null;
};

export function Board({ deals: initial, counts, preview }: { deals: BoardDeal[]; counts: Record<string, number>; preview: number }) {
  const [deals, setDeals] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const dndId = useId();

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = String(e.active.id);
    const stage = e.over ? String(e.over.id) : null;
    const deal = deals.find((d) => d.id === id);
    if (!deal || !stage || stage === deal.stage) return;
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage, updatedAt: new Date().toISOString() } : d)));
    startTransition(() => {
      moveDeal(id, stage).catch(() => setDeals(initial));
    });
  }

  // "Move to Deal Lost" on a card: same as dragging it to the Deal Lost column, one click
  const markLost = (id: string) => {
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage: "Deal Lost", updatedAt: new Date().toISOString() } : d)));
    startTransition(() => {
      moveDeal(id, "Deal Lost").catch(() => setDeals(initial));
    });
  };
  const active = activeId ? deals.find((d) => d.id === activeId) : null;

  return (
    <DndContext id={dndId} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-88px)] gap-3 overflow-x-auto px-6 py-4">
        {BOARD_ORDER.map((stage) => {
          const items = deals.filter((d) => d.stage === stage);
          const total = counts[stage] ?? items.length;
          return <Column key={stage} stage={stage} deals={items} total={total} truncated={total > items.length} preview={preview} onLost={markLost} />;
        })}
      </div>
      <DragOverlay>{active ? <Card deal={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ stage, deals, total, truncated, preview, onLost }: { stage: string; deals: BoardDeal[]; total: number; truncated: boolean; preview: number; onLost: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const terminal = stage === "Deal Closed" || stage === "Deal Lost";
  const sum = deals.reduce((n, d) => n + (d.requestedAmount ?? 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-lg border ${isOver ? "border-sky-600 bg-sky-50" : "border-line bg-cream/60"} ${terminal ? "opacity-90" : ""}`}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div>
          <div className="text-sm font-semibold">{stage}</div>
          {sum > 0 && <div className="text-[11px] text-muted">{fmtMoney(sum)} requested</div>}
        </div>
        <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-ink-soft">{total}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {deals.map((d) => (
          <Card key={d.id} deal={d} onLost={onLost} />
        ))}
        {deals.length === 0 && <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-muted">Drop a deal here</div>}
        {truncated && (
          <Link href={`/deals/list?stage=${encodeURIComponent(stage)}`} className="block rounded-md px-3 py-2 text-center text-xs text-sky-600 hover:underline">
            Showing latest {preview} · view all {total}
          </Link>
        )}
      </div>
    </div>
  );
}

function Card({ deal, overlay = false, onLost }: { deal: BoardDeal; overlay?: boolean; onLost?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id, disabled: overlay });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const router = useRouter();
  const down = useRef<{ x: number; y: number } | null>(null);
  // a click anywhere on the card opens the ticket; moving more than a few pixels is a drag, not a click
  const openIfClick = (e: React.MouseEvent) => {
    if (overlay || !down.current) return;
    const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y);
    down.current = null;
    if (moved < 6 && !(e.target as HTMLElement).closest("a,button")) router.push(`/deals/${deal.id}`);
  };
  const title = deal.propertyName ?? deal.name;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onPointerDownCapture={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={openIfClick}
      title="Click to open; drag to move between stages"
      className={`card cursor-pointer p-3 text-sm active:cursor-grabbing ${isDragging && !overlay ? "opacity-30" : ""} ${overlay ? "rotate-1 shadow-xl" : ""}`}
    >
      {deal.sponsorName && <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-sky-600">{deal.sponsorName}</div>}
      <Link href={`/deals/${deal.id}`} className="mt-0.5 block font-medium leading-snug hover:underline" onPointerDown={(e) => e.stopPropagation()}>
        {title}
      </Link>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-muted">
        {deal.assetClass && <span className="chip bg-cream">{deal.assetClass}</span>}
        {(deal.city || deal.state) && <span className="chip bg-cream">{[deal.city, deal.state].filter(Boolean).join(", ")}</span>}
        {deal.requestedAmount != null && (
          <span className="chip bg-sky-50">
            {fmtMoney(deal.requestedAmount)}
            {deal.requestType ? ` ${deal.requestType.toLowerCase()}` : ""}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="truncate">{deal.ownerName ?? "Unassigned"}</span>
        <span>{deal.closeDate ? fmtDate(deal.closeDate) : fmtDate(deal.updatedAt)}</span>
      </div>
      {onLost && deal.stage !== "Deal Lost" && deal.stage !== "Deal Closed" && (
        <button
          type="button"
          className="mt-2 w-full rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:border-stone-300 hover:bg-stone-100 hover:text-ink"
          title="Move this deal to Deal Lost; it leaves Deal momentum and LP follow-ups"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Move "${title}" to Deal Lost?`)) onLost(deal.id);
          }}
        >
          Move to Deal Lost
        </button>
      )}
    </div>
  );
}
