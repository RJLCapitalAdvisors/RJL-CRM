"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

/**
 * A form that saves itself: any change inside it submits the server action after a short pause
 * (typing waits a bit longer than a tick or a pick). Shows a quiet "Saved" note. No Save button needed.
 * The action is called from onSubmit rather than through <form action>: React resets a form after a form action
 * runs, and a controlled <select> then snaps back to the option it had when the page first loaded while the
 * component's state keeps the new pick (the mirpasot count showed 1 with three rows on screen). Calling the action
 * ourselves leaves the DOM alone.
 */
export function AutoSaveForm({ action, children, className }: { action: (fd: FormData) => void | Promise<void>; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "saved">("idle");
  const [, start] = useTransition();

  const schedule = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    setState("pending");
    timer.current = setTimeout(() => ref.current?.requestSubmit(), delay);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await action(fd);
          setState("saved");
          setTimeout(() => setState("idle"), 1800);
        });
      }}
      onInput={(e) => {
        const t = e.target as HTMLElement;
        const typing = t instanceof HTMLInputElement ? !["checkbox", "radio", "range"].includes(t.type) : t instanceof HTMLTextAreaElement || t.isContentEditable;
        schedule(typing ? 900 : 250);
      }}
      onChange={(e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && ["checkbox", "radio", "range"].includes(t.type))) schedule(250);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault(); // Enter should not blank-submit mid-typing
      }}
    >
      {children}
      <div className="h-5 py-1 text-right text-[11px] text-muted">{state === "pending" ? "Saving…" : state === "saved" ? "Saved" : ""}</div>
    </form>
  );
}
