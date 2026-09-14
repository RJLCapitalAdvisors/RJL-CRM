"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Text you edit in place: a borderless textarea that grows with its content and reads like the surrounding text.
 * Given `onSave`, it saves itself a moment after typing stops and when focus leaves, with a quiet "Saved".
 * Without `onSave` it is just the input for an autosaving form around it.
 */
export function GrowingTextarea({ name, defaultValue, placeholder, className = "", style, onSave, minRows = 1 }: { name?: string; defaultValue?: string | null; placeholder?: string; className?: string; style?: React.CSSProperties; onSave?: (value: string) => Promise<void> | void; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(defaultValue ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 18)}px`;
  };
  useEffect(grow, []);

  const save = () => {
    const v = ref.current?.value ?? "";
    if (!onSave || v === last.current) return;
    last.current = v;
    setState("saving");
    Promise.resolve(onSave(v)).then(() => {
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    });
  };
  const onInput = () => {
    grow();
    if (!onSave) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };

  return (
    <span className="relative block">
      <textarea
        ref={ref}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        rows={minRows}
        onInput={onInput}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          save();
        }}
        className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 leading-snug outline-none focus:bg-[#f7f9fc] focus:ring-1 focus:ring-sky/60 ${className}`}
        style={{ fontFamily: "inherit", fontSize: "inherit", color: "inherit", ...style }}
      />
      {state !== "idle" && <span className="pointer-events-none absolute -right-1 -top-3 text-[8pt] text-muted">{state === "saving" ? "Saving…" : "Saved"}</span>}
    </span>
  );
}
