"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { previewCopyAction, sendTestCopyAction } from "@/app/campaigns/actions";

export type BlastCopy = { subject: string; bodyHtml: string };

const PREHEADER_RE = /<div style="display:none[^"]*">([\s\S]*?)<\/div>/i;
export const readPreheader = (html: string) => html.match(PREHEADER_RE)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
export const writePreheader = (html: string, text: string) => {
  const div = `<div style="display:none;font-size:1px;color:#f6f9fc;line-height:1px;max-height:0;overflow:hidden">${text}</div>`;
  return PREHEADER_RE.test(html) ? html.replace(PREHEADER_RE, div) : `${div}\n${html}`;
};

const frame = (html: string, editable: boolean) =>
  `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:#f6f9fc}body{font-family:Helvetica,Arial,sans-serif;color:#1a2321}${editable ? "body:focus{outline:none}[contenteditable] a{cursor:text}" : ""}</style></head><body${editable ? ' contenteditable="true" spellcheck="true"' : ""}>${html}</body></html>`;

/**
 * The email, the way HubSpot shows it: who it goes to, from, subject line, preview text, then the email itself,
 * big, exactly as it will render. Click into the email to edit the words in place; flip to "As the reader sees it"
 * to check the merged result; send a test to yourself at any time.
 */
export function BlastEditor({ copy, onChange, onSave, sendTo, from, me, templateKey }: { copy: BlastCopy; onChange: (c: BlastCopy) => void; onSave?: (c: BlastCopy) => Promise<void>; sendTo: React.ReactNode; from: string; me: string | null; templateKey?: string }) {
  const [mode, setMode] = useState<"edit" | "reader" | "html">("edit");
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [saving, startSave] = useTransition();
  const iframe = useRef<HTMLIFrameElement>(null);
  // the editable frame is only re-created when the template changes or we come back from another mode,
  // so typing inside it never loses the cursor
  const [frameKey, setFrameKey] = useState(0);
  useEffect(() => {
    setFrameKey((k) => k + 1);
  }, [templateKey]);

  const preheader = readPreheader(copy.bodyHtml);
  const setBody = (bodyHtml: string) => onChange({ ...copy, bodyHtml });

  const wire = () => {
    const doc = iframe.current?.contentDocument;
    if (!doc) return;
    const body = doc.body;
    body.addEventListener("input", () => setBody(body.innerHTML));
    body.addEventListener("blur", () => setBody(body.innerHTML));
  };

  const showReader = () =>
    start(async () => {
      setPreview(await previewCopyAction(copy));
      setMode("reader");
    });
  const test = () =>
    start(async () => {
      const r = await sendTestCopyAction(copy);
      setNote(r);
    });
  const save = () => onSave && startSave(async () => {
    await onSave(copy);
    setNote("Saved.");
  });

  return (
    <div className="card">
      <div className="space-y-2 border-b border-line px-5 py-4 text-sm">
        <div className="flex gap-2">
          <span className="w-24 shrink-0 font-semibold">Send to:</span>
          <span className="min-w-0">{sendTo}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-24 shrink-0 font-semibold">From:</span>
          <span>{from}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 font-semibold" htmlFor="blastSubject">
            Subject line:
          </label>
          <input id="blastSubject" value={copy.subject} onChange={(e) => onChange({ ...copy, subject: e.target.value })} className="input" />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 font-semibold" htmlFor="blastPreview">
            Preview text:
          </label>
          <input id="blastPreview" value={preheader} onChange={(e) => setBody(writePreheader(copy.bodyHtml, e.target.value))} className="input" placeholder="The line the inbox shows under the subject" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-cream-50 px-5 py-2 text-xs">
        <button type="button" onClick={() => { setMode("edit"); setFrameKey((k) => k + 1); }} className={`rounded-md px-3 py-1.5 ${mode === "edit" ? "bg-ink text-white" : "hover:bg-cream"}`}>
          Edit in place
        </button>
        <button type="button" onClick={showReader} className={`rounded-md px-3 py-1.5 ${mode === "reader" ? "bg-ink text-white" : "hover:bg-cream"}`}>
          {busy && mode !== "reader" ? "Rendering…" : "As the reader sees it"}
        </button>
        <button type="button" onClick={() => setMode("html")} className={`rounded-md px-3 py-1.5 ${mode === "html" ? "bg-ink text-white" : "hover:bg-cream"}`}>
          HTML
        </button>
        <span className="text-muted">{mode === "edit" ? "Click into the email and type. Merge fields like {{contact.firstName|there}} fill in per person." : mode === "reader" ? `Merged for ${me ?? "you"} as a sample reader.` : "The raw HTML of the email."}</span>
        <span className="ml-auto flex items-center gap-2">
          {note && <span className="text-muted">{note}</span>}
          {onSave && (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save copy"}
            </button>
          )}
          {me && (
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={test}>
              Send a test to {me}
            </button>
          )}
        </span>
      </div>

      <div className="bg-[#f6f9fc] p-4">
        {mode === "edit" && <iframe key={frameKey} ref={iframe} title="Email" srcDoc={frame(copy.bodyHtml, true)} onLoad={wire} className="h-[75vh] w-full rounded-md border border-line bg-white" />}
        {mode === "reader" && preview && <iframe title="Email as the reader sees it" srcDoc={frame(preview.html, false)} className="h-[75vh] w-full rounded-md border border-line bg-white" />}
        {mode === "reader" && !preview && <div className="py-10 text-center text-sm text-muted">Rendering…</div>}
        {mode === "html" && <textarea value={copy.bodyHtml} onChange={(e) => setBody(e.target.value)} rows={30} className="input h-[75vh] font-mono text-[12px]" spellCheck={false} />}
      </div>
    </div>
  );
}
