"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

/**
 * Zoom for a data window (Jonathan, Sep 22, 2026): minus and plus in the corner scale everything inside, so a big
 * table can be read small to see more rows and columns, or large to read comfortably. Remembered per window in
 * this browser. Applies CSS zoom to the content, so sticky headers and scrolling keep working.
 */
const STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

export function useZoom(id: string): [number, (z: number) => void] {
  const [zoom, setZoomState] = useState(1);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(`zoom:${id}`));
      if (v && STEPS.includes(v)) setZoomState(v);
    } catch {
      /* nothing remembered */
    }
  }, [id]);
  const setZoom = (z: number) => {
    setZoomState(z);
    try {
      localStorage.setItem(`zoom:${id}`, String(z));
    } catch {
      /* private window */
    }
  };
  return [zoom, setZoom];
}

export function ZoomControls({ zoom, setZoom, className = "" }: { zoom: number; setZoom: (z: number) => void; className?: string }) {
  const i = STEPS.indexOf(zoom);
  const step = (d: number) => setZoom(STEPS[Math.min(STEPS.length - 1, Math.max(0, (i < 0 ? STEPS.indexOf(1) : i) + d))]);
  return (
    <div className={`inline-flex items-center overflow-hidden rounded-md border border-line bg-paper text-xs shadow-sm ${className}`} style={{ zoom: 1 }}>
      <button type="button" onClick={() => step(-1)} disabled={i <= 0} className="px-1.5 py-1 hover:bg-cream disabled:opacity-30" title="Smaller: see more on the page">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => setZoom(1)} className="min-w-[40px] px-1 py-1 tabular-nums text-muted hover:bg-cream" title="Back to normal size">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={() => step(1)} disabled={i >= STEPS.length - 1} className="px-1.5 py-1 hover:bg-cream disabled:opacity-30" title="Larger">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Wrap the content of a data window: the controls sit in the top-right corner and the content scales. */
export function ZoomBox({ id, children }: { id: string; children: React.ReactNode }) {
  const [zoom, setZoom] = useZoom(id);
  return (
    <div className="relative">
      <div className="pointer-events-none sticky top-0 z-30 flex justify-end pr-2" style={{ height: 0 }}>
        <div className="pointer-events-auto mt-1">
          <ZoomControls zoom={zoom} setZoom={setZoom} />
        </div>
      </div>
      <div style={{ zoom }}>{children}</div>
    </div>
  );
}
