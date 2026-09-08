"use client";

import { useEffect, useState } from "react";
import type { Step } from "@/lib/onboarding";

/** The setup checklist with tick boxes that remember themselves on this browser (per person). */
export function OnboardingChecklist({ steps, storageKey }: { steps: Step[]; storageKey: string }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading this browser's saved ticks after hydration is the point
      if (raw) setDone(new Set(JSON.parse(raw) as number[]));
    } catch {
      /* no storage */
    }
  }, [storageKey]);
  const toggle = (i: number) =>
    setDone((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...n]));
      } catch {
        /* no storage */
      }
      return n;
    });
  return (
    <ol className="divide-y divide-line">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-3">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-ink" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Done: ${s.title}`} />
          <div className={`min-w-0 flex-1 ${done.has(i) ? "opacity-60" : ""}`}>
            <div className="font-medium">
              {i + 1}. {s.title}
              {s.link && (
                <>
                  {" "}
                  <a href={s.link.href} className="text-sm font-normal text-sky-700 hover:underline" target={s.link.href.startsWith("http") ? "_blank" : undefined}>
                    {s.link.label}
                  </a>
                </>
              )}
            </div>
            <div className="text-sm text-ink-soft">{s.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
