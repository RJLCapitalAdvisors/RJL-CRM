"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { IL_DEAL_STAGES, nisShort } from "@/lib/israel";
import { moveIlDeal } from "../actions";

export type IlBoardDeal = { id: string; name: string; stage: string; apartment: string | null; city: string | null; buyer: string | null; agent: string | null; price: number | null; updatedAt: string };

/** The RJL Israel funnel: one column per stage, drag a deal to move it, click a card to open it. */
export function IlBoard({ deals: initial }: { deals: IlBoardDeal[] }) {
  const [deals, setDeals] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const dndId = useId();
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const id = String(e.active.id);
    const stage = e.over ? String(e.over.id) : null;
    const deal = deals.find((d) => d.id === id);
    if (!deal || !stage || stage === deal.stage) return;
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage, updatedAt: new Date().toISOString() } : d)));
    start(() => {
      moveIlDeal(id, stage).catch(() => setDeals(initial));
    });
  };
  const active = activeId ? deals.find((d) => d.id === activeId) : null;
  // Lost first, then Mentioned (properties floated by email), then the funnel proper
  const order = ["Lost", "Mentioned", ...IL_DEAL_STAGES.filter((s) => s !== "Lost" && s !== "Mentioned")];
  return (
    <DndContext id={dndId} sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-88px)] gap-3 overflow-x-auto px-6 py-4">
        {order.map((stage) => (
          <Column key={stage} stage={stage} deals={deals.filter((d) => d.stage === stage)} />
        ))}
      </div>
      <DragOverlay>{active ? <Card deal={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ stage, deals }: { stage: string; deals: IlBoardDeal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const terminal = stage === "Closed" || stage === "Lost";
  const mentioned = stage === "Mentioned";
  const sum = deals.reduce((n, d) => n + (d.price ?? 0), 0);
  return (
    <div ref={setNodeRef} className={`flex w-64 shrink-0 flex-col rounded-lg border ${isOver ? "border-sky-600 bg-sky-50" : "border-line bg-cream/60"} ${terminal ? "opacity-90" : ""}`}>
      <div className="flex items-center justify-between px-3 py-2">
        <div>
          <div className="text-sm font-semibold">{stage}</div>
          {sum > 0 && <div className="text-[11px] text-muted">{nisShort(sum)} in play</div>}
        </div>
        <span className="chip bg-paper text-[11px]">{deals.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {deals.map((d) => (
          <Card key={d.id} deal={d} />
        ))}
        {deals.length === 0 && <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-muted">{mentioned ? "Properties people mention by email land here" : "Drop here"}</div>}
      </div>
    </div>
  );
}

function Card({ deal, overlay = false }: { deal: IlBoardDeal; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id, disabled: overlay });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`card p-3 text-sm ${isDragging ? "opacity-40" : ""} ${overlay ? "rotate-1 shadow-lg" : "hover:border-sky-600"}`}>
      <Link href={`/israel/deals/${deal.id}`} className="block" onClick={(e) => isDragging && e.preventDefault()}>
        {deal.buyer && <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-sky-600">{deal.buyer}</div>}
        <div className="mt-0.5 font-medium leading-snug">{deal.apartment ?? deal.name}</div>
        <div className="mt-1 text-xs text-muted">{[deal.city, deal.agent ? `agent ${deal.agent}` : null].filter(Boolean).join(" · ")}</div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
          <span>{deal.price ? nisShort(deal.price) : ""}</span>
          <span>{new Date(deal.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        </div>
      </Link>
    </div>
  );
}
