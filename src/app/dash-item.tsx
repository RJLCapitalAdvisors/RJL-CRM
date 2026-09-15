"use client";

import { createContext, useContext, useState, useTransition } from "react";

/**
 * A dashboard row that can take itself off the screen. The buttons inside (ItemForm) hide the row the instant they
 * are clicked and run the server action behind it; if the action fails the row comes back with the error under it.
 * The server still re-renders the page afterwards, but nobody waits on that.
 */
const Ctx = createContext<{ vanish: () => void; revive: (err: string) => void }>({ vanish: () => {}, revive: () => {} });

export function Item({ className, children, as = "li" }: { className?: string; children: React.ReactNode; as?: "li" | "tr" | "div" }) {
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (gone) return null;
  const Tag = as;
  return (
    <Ctx.Provider value={{ vanish: () => setGone(true), revive: (e) => { setGone(false); setErr(e); } }}>
      <Tag className={className} title={err ?? undefined}>
        {children}
        {err && as !== "tr" && <div className="mt-1 text-xs text-red-700">{err}</div>}
      </Tag>
    </Ctx.Provider>
  );
}

/** One action button on a row. `keep` leaves the row on screen (for actions that do not remove it). */
export function ItemForm({ action, className, title, children, keep = false }: { action: () => Promise<unknown>; className?: string; title?: string; children: React.ReactNode; keep?: boolean }) {
  const { vanish, revive } = useContext(Ctx);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={pending}
      onClick={() => {
        if (!keep) vanish();
        start(async () => {
          try {
            await action();
          } catch (e) {
            revive(e instanceof Error ? e.message : "That did not save. Try again.");
          }
        });
      }}
    >
      {pending && keep ? "Saving…" : children}
    </button>
  );
}
