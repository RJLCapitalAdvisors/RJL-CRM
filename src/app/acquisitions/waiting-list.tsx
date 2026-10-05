"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolvePendingAction } from "./actions";

type Item = { id: string; n: number; address: string; question: string; guess: "junk" | "pipeline" | "deal" | "live"; propertyId: string | null; sourceFile: string | null; since: string };
const LABEL: Record<Item["guess"], string> = { junk: "Junk Properties", pipeline: "Deals Pipeline list", deal: "Deals board", live: "a live property" };

/**
 * Waiting on Shawn (Oct 5, 2026): the properties an import held back for his decision. Each shows what the importer
 * saw and its best guess; Confirm applies the guess, the other buttons override it, Dismiss writes nothing. The same
 * answers can be given in Ask the CRM ("yes to all"). Nothing of a held property is written until then.
 */
export function WaitingList({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Record<string, string>>({});
  const router = useRouter();
  const act = (id: string, action: "confirm" | "junk" | "pipeline" | "deal" | "live" | "dismiss") =>
    start(async () => {
      const junkReason = action === "junk" ? window.prompt("Removed Reason (gas station, too small, duplicate of…):") ?? undefined : undefined;
      if (action === "junk" && junkReason === undefined) return;
      const r = await resolvePendingAction(id, action, { junkReason: junkReason?.trim() || undefined });
      setMsg((m) => ({ ...m, [id]: r.ok ? r.did : r.reason }));
      router.refresh();
    });
  return (
    <div className="card mx-auto max-w-4xl border-amber-300">
      <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-3">
        <div className="text-sm font-semibold text-amber-900">Waiting on Shawn</div>
        <span className="text-xs text-amber-800">{items.length} held from imports · nothing is written until you answer here or in Ask the CRM</span>
      </div>
      <ol className="divide-y divide-line">
        {items.map((w) => (
          <li key={w.id} className="px-4 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {w.n}. {w.propertyId ? <Link href={`/acquisitions/properties/${w.propertyId}`} className="hover:underline">{w.address}</Link> : w.address}
                  {w.sourceFile && <span className="ml-2 text-xs font-normal text-muted">from {w.sourceFile}</span>}
                </div>
                <div className="mt-0.5 text-ink-soft">{w.question}</div>
                <div className="mt-0.5 text-xs text-muted">Best guess: {LABEL[w.guess]} · held {new Date(w.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                {msg[w.id] && <div className="mt-1 text-xs text-emerald-800">{msg[w.id]}</div>}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <button type="button" disabled={pending} onClick={() => act(w.id, "confirm")} className="btn-primary px-3 py-1 text-xs" title={`Do the best guess: ${LABEL[w.guess]}`}>
                  Confirm
                </button>
                {(["junk", "pipeline", "deal", "live"] as const).filter((a) => a !== w.guess).map((a) => (
                  <button key={a} type="button" disabled={pending} onClick={() => act(w.id, a)} className="btn-secondary px-2 py-1 text-xs" title={`Instead: ${LABEL[a]}`}>
                    {a === "junk" ? "Junk" : a === "pipeline" ? "Pipeline" : a === "deal" ? "Deal" : "Live"}
                  </button>
                ))}
                <button type="button" disabled={pending} onClick={() => act(w.id, "dismiss")} className="btn-ghost px-2 py-1 text-xs text-muted" title="Write nothing and drop it from the list">
                  Dismiss
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
