"use client";

import { useState } from "react";

/**
 * A text box whose lines are bullets: every non-empty line shows with a bullet in front, Enter starts the next one.
 * The form gets the plain lines (no bullets) under `name`, one per line.
 */
export function BulletTextarea({ name, value, placeholder, rows = 3 }: { name: string; value?: string | null; placeholder?: string; rows?: number }) {
  const clean = (s: string) => s.split(/\r?\n/).map((l) => l.replace(/^\s*[•\-*]\s*/, ""));
  const bullet = (ls: string[]) => ls.map((l, i) => (l.trim() || i === ls.length - 1 ? (l.trim() ? `• ${l.trim()}` : "") : "")).join("\n");
  const [text, setText] = useState(() => bullet(clean(value ?? "")));
  const plain = clean(text).map((l) => l.trim()).filter(Boolean).join("\n");
  return (
    <>
      <textarea
        value={text}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const el = e.currentTarget;
            const pos = el.selectionStart;
            const next = `${text.slice(0, pos)}\n• ${text.slice(el.selectionEnd)}`;
            setText(next);
            requestAnimationFrame(() => el.setSelectionRange(pos + 3, pos + 3));
          }
        }}
        onFocus={(e) => {
          if (!e.currentTarget.value) setText("• ");
        }}
        onBlur={() => setText(bullet(clean(text)))}
        className="input resize-y leading-6"
      />
      <input type="hidden" name={name} value={plain} />
    </>
  );
}
