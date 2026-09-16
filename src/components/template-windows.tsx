"use client";

import { useRef, useState, useTransition } from "react";
import { TokenEditor, type Token } from "@/components/token-editor";
import { saveTemplateInline } from "@/app/templates/actions";

/**
 * One template, shown the way the email goes out: the name on top, the subject line, then the body, both with merge
 * tokens as light blue chips you can drop anywhere. Type in place, bold or bullet the words, and it saves when you
 * pause. The sender's Outlook signature is added when the email goes out.
 */
export type TemplateRow = { id: string; name: string; kind: string; subject: string; bodyHtml: string };

export function TemplateWindow({ t, tokens, tall = false }: { t: TemplateRow; tokens: Token[]; tall?: boolean }) {
  const [name, setName] = useState(t.name);
  const cur = useRef({ subject: t.subject, body: t.bodyHtml });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(JSON.stringify({ name: t.name, subject: t.subject, body: t.bodyHtml }));

  const save = () => {
    const next = { name, subject: cur.current.subject, body: cur.current.body };
    const key = JSON.stringify(next);
    if (key === last.current) return;
    last.current = key;
    setState("saving");
    start(async () => {
      await saveTemplateInline(t.id, { name: next.name, subject: next.subject, bodyHtml: next.body });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    });
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-cream px-3 py-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} className="input min-w-0 flex-1 py-1 text-sm font-semibold" aria-label="Template name" />
        {t.kind === "BLAST" && <span className="chip bg-sky/40 text-[10px]">blast</span>}
        <span className="w-12 text-right text-[10px] text-muted">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
      </div>
      <div className="flex items-stretch border-b border-line">
        <div className="flex shrink-0 items-center border-r border-line bg-cream-50 px-3 text-xs font-semibold text-muted">Subject</div>
        <TokenEditor
          value={t.subject}
          singleLine
          tokens={tokens}
          placeholder="Subject line"
          className="min-w-0 flex-1 [&>div:first-child]:border-b-0 [&>div:first-child]:bg-transparent"
          onChange={(v) => {
            cur.current.subject = v;
            schedule();
          }}
        />
      </div>
      <TokenEditor
        value={t.bodyHtml}
        tokens={tokens}
        placeholder="Hi there, then the email as you would write it. Drop tokens where the deal's facts go."
        className="bg-white"
        minHeight={tall ? 480 : 300}
        onChange={(v) => {
          cur.current.body = v;
          schedule();
        }}
      />
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Your Outlook signature is added under the email when it goes out.</div>
    </div>
  );
}
