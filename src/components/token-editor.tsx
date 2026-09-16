"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, List, Underline } from "lucide-react";

/**
 * The email as it will read, editable in place, with merge tokens as light blue chips you drop anywhere (HubSpot
 * style). Stored as HTML with {{key|fallback}} placeholders; shown with each placeholder as a chip that reads
 * "Deal: Sponsor". Type around the chips, bold or bullet the words, insert a token at the cursor from the menu.
 * The same component edits a subject line (singleLine) and a rich body.
 */
export type Token = { key: string; label: string; group: string };

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

function chipHtml(key: string, fallback: string | undefined, tokens: Token[]) {
  const t = tokens.find((x) => x.key === key);
  const label = t ? `${t.group}: ${t.label}` : key;
  return `<span class="tok" contenteditable="false" data-token="${esc(key)}"${fallback ? ` data-fallback="${esc(fallback)}"` : ""} title="${esc(fallback ? `${key}, or "${fallback}" when blank` : key)}">${esc(label)}</span>`;
}

/** Storage HTML (or plain text) to what the editor shows. */
export function toDisplay(stored: string, tokens: Token[], singleLine: boolean): string {
  let html = stored;
  if (!isHtml(html)) {
    const escd = esc(html);
    html = singleLine ? escd : escd.split(/\n{2,}/).map((p) => `<div>${p.replace(/\n/g, "<br>")}</div>`).join("<div><br></div>");
  }
  return html.replace(TOKEN_RE, (_, key: string, fb?: string) => chipHtml(key, fb, tokens));
}

/** What the editor shows back to storage HTML: every chip becomes its {{token}} again. */
export function toStored(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("span.tok").forEach((el) => {
    const key = el.getAttribute("data-token") ?? "";
    const fb = el.getAttribute("data-fallback");
    el.replaceWith(document.createTextNode(`{{${key}${fb ? `|${fb}` : ""}}}`));
  });
  return clone.innerHTML.replace(/​/g, "");
}

export function TokenEditor({ value, onChange, tokens, singleLine = false, placeholder, className = "", style, minHeight = 220 }: { value: string; onChange: (stored: string) => void; tokens: Token[]; singleLine?: boolean; placeholder?: string; className?: string; style?: React.CSSProperties; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(!value.trim());
  const init = useRef(value);

  // the initial content only; after that the browser owns the DOM and we read it back
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = toDisplay(init.current, tokens, singleLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = () => {
    const sel = document.getSelection();
    if (!sel?.rangeCount || !ref.current) return;
    const r = sel.getRangeAt(0);
    if (ref.current.contains(r.commonAncestorContainer)) range.current = r.cloneRange();
  };
  const emit = () => {
    if (!ref.current) return;
    const stored = toStored(ref.current);
    setEmpty(!ref.current.textContent?.trim() && !ref.current.querySelector(".tok"));
    onChange(stored);
  };
  const focusRange = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection();
    if (!sel) return;
    if (range.current && el.contains(range.current.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
  const insertToken = (key: string) => {
    if (!key) return;
    focusRange();
    const sel = document.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const wrap = document.createElement("span");
    wrap.innerHTML = chipHtml(key, undefined, tokens) + " ";
    const chip = wrap.firstChild as HTMLElement;
    const space = wrap.lastChild as Text;
    r.insertNode(space);
    r.insertNode(chip);
    r.setStartAfter(space);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    remember();
    emit();
  };
  const cmd = (c: string) => {
    focusRange();
    document.execCommand(c);
    remember();
    emit();
  };
  const groups = [...new Set(tokens.map((t) => t.group))];
  const F: React.CSSProperties = { fontFamily: "Calibri, Arial, sans-serif", fontSize: "11pt", lineHeight: 1.5, ...style };
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-cream-50 px-2 py-1 text-xs">
        {!singleLine && (
          <>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")} className="btn-ghost p-1" title="Bold">
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")} className="btn-ghost p-1" title="Italic">
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("underline")} className="btn-ghost p-1" title="Underline">
              <Underline className="h-3.5 w-3.5" />
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertUnorderedList")} className="btn-ghost p-1" title="Bulleted list">
              <List className="h-3.5 w-3.5" />
            </button>
            <span className="mx-1 h-4 w-px bg-line" />
          </>
        )}
        <select value="" onMouseDown={remember} onChange={(e) => insertToken(e.target.value)} className="input py-0.5 text-xs" title="Drops a token where the cursor is">
          <option value="">Insert a token…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {tokens
                .filter((t) => t.group === g)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="relative">
        {empty && placeholder && (
          <div className="pointer-events-none absolute left-3 top-2 text-muted" style={F}>
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={() => {
            remember();
            emit();
          }}
          onKeyUp={remember}
          onMouseUp={remember}
          onBlur={() => {
            remember();
            emit();
          }}
          onKeyDown={(e) => {
            if (singleLine && e.key === "Enter") e.preventDefault();
          }}
          onPaste={(e) => {
            // plain words only; Word's markup stays out
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          className={`tok-editor outline-none ${singleLine ? "whitespace-nowrap overflow-x-auto px-3 py-1.5" : "px-4 py-3"}`}
          style={{ ...F, minHeight: singleLine ? undefined : minHeight }}
        />
      </div>
    </div>
  );
}
