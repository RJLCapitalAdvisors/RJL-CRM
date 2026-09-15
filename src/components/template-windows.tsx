"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { MERGE_FIELDS } from "@/lib/merge";
import { createBlankTemplate, deleteTemplateInline, saveTemplateInline } from "@/app/templates/actions";

/**
 * Email templates as windows, like the Required Items Lists. Each window is one template shown the way the email
 * goes out: the name on top, the subject line, then the body in plain words with the merge fields as light blue
 * tokens. Type in place; "Insert a field" drops a token at the cursor; text saves itself when you pause. The x
 * removes a template, the plus square opens a new one. On the Send deal page you pick which of these to use.
 */
export type TemplateRow = { id: string; name: string; kind: string; subject: string; bodyHtml: string };

const TOKEN = /\{\{\s*[a-zA-Z0-9_.]+\s*(?:\|[^}]*?)?\}\}/g;
const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The text with every merge field wrapped in a light blue token; the same characters, so it lines up under the textarea. */
const highlight = (t: string) => esc(t).replace(TOKEN, (m) => `<mark style="background:#dbeafe;color:#1e40af;border-radius:3px">${m}</mark>`) + (t.endsWith("\n") ? "​" : "");
/** Old HTML templates read as text so they can be edited in plain words. */
const toPlain = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const GROUPS: { label: string; test: (k: string) => boolean }[] = [
  { label: "The person", test: (k) => k.startsWith("contact.") || k.startsWith("company.") || k === "openingLine" },
  { label: "The deal", test: (k) => k.startsWith("deal.") && !k.startsWith("deal.details.") },
  { label: "Checklist answers", test: (k) => k.startsWith("deal.details.") },
  { label: "Other", test: () => true },
];

export function TemplateWindows({ templates }: { templates: TemplateRow[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
      {templates.map((t) => (
        <TemplateWindow key={t.id} t={t} />
      ))}
      <button type="button" disabled={pending} onClick={() => start(() => createBlankTemplate())} className="flex min-h-[360px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-muted transition hover:border-sky-600 hover:text-ink disabled:opacity-50" title="New template">
        <Plus className="h-10 w-10" />
        <span className="text-sm">{pending ? "Adding…" : "New template"}</span>
      </button>
    </div>
  );
}

export function TemplateWindow({ t, tall = false }: { t: TemplateRow; tall?: boolean }) {
  const [name, setName] = useState(t.name);
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.bodyHtml);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [pending, start] = useTransition();
  const ta = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(JSON.stringify({ name: t.name, subject: t.subject, body: t.bodyHtml }));
  const html = isHtml(body);

  const grow = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 160)}px`;
  };
  useEffect(grow, [body]);

  const save = (next: { name: string; subject: string; body: string }) => {
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
  const schedule = (next: { name: string; subject: string; body: string }) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 900);
  };
  const insert = (key: string) => {
    const el = ta.current;
    const token = `{{${key}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const { selectionStart, selectionEnd } = el;
    const next = body.slice(0, selectionStart) + token + body.slice(selectionEnd);
    setBody(next);
    schedule({ name, subject, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart + token.length, selectionStart + token.length);
    });
  };
  const F: React.CSSProperties = { fontFamily: "Calibri, Arial, sans-serif", fontSize: "11pt", lineHeight: 1.5 };
  return (
    <div className="card flex flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-cream px-3 py-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save({ name, subject, body })} className="input min-w-0 flex-1 py-1 text-sm font-semibold" aria-label="Template name" />
        {t.kind === "BLAST" && <span className="chip bg-sky/40 text-[10px]">blast</span>}
        <span className="w-12 text-right text-[10px] text-muted">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
        <button type="button" disabled={pending} onClick={() => confirm(`Delete the template "${name}"?`) && start(() => deleteTemplateInline(t.id))} className="btn-ghost shrink-0 p-1 text-muted hover:text-red-700" title="Delete this template">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm">
        <span className="shrink-0 text-xs text-muted">Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => save({ name, subject, body })} className="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none" style={F} placeholder="Subject line, with fields if you like" />
      </div>
      <div className="flex items-center gap-2 border-b border-line bg-cream-50 px-3 py-1.5 text-xs">
        <select value="" onChange={(e) => e.target.value && insert(e.target.value)} className="input py-0.5 text-xs" title="Drops a merge field where the cursor is">
          <option value="">Insert a field…</option>
          {GROUPS.map((g) => {
            const items = MERGE_FIELDS.filter((f) => g.test(f.key) && !GROUPS.slice(0, GROUPS.indexOf(g)).some((h) => h.test(f.key)));
            return items.length ? (
              <optgroup key={g.label} label={g.label}>
                {items.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        <span className="text-muted">Fields fill in per person and per deal when the email goes out.</span>
        {html && (
          <button type="button" className="ml-auto text-sky-700 hover:underline" onClick={() => { const plain = toPlain(body); setBody(plain); save({ name, subject, body: plain }); }}>
            Convert to plain words
          </button>
        )}
      </div>
      <div className="relative bg-white px-3 py-2" style={F}>
        {!html && <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-ink" style={F} dangerouslySetInnerHTML={{ __html: highlight(body) }} />}
        <textarea
          ref={ta}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            schedule({ name, subject, body: e.target.value });
          }}
          onBlur={() => save({ name, subject, body })}
          spellCheck={false}
          className={`relative block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none ${html ? "font-mono text-[12px] text-ink" : "text-transparent caret-ink"} ${tall ? "min-h-[60vh]" : ""}`}
          style={html ? undefined : { ...F, WebkitTextFillColor: "transparent" }}
          placeholder="Hi {{contact.firstName|there}},"
        />
      </div>
      {html && <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">This one is still HTML. Convert to plain words to edit it like the others.</div>}
    </div>
  );
}
