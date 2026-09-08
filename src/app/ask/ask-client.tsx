"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquare, Send } from "lucide-react";
import type { ChatMessage } from "@/lib/ask-crm";
import { askAction } from "./actions";

type Turn = ChatMessage & { lookups?: string[] };

const STARTERS = ["What is still missing on Woodburn Exchange?", "Which LPs passed on retail deals in Florida this year, and why?", "Who do we talk to at Corebridge now?", "Summarize the investor feedback on Palm Beach County Retail.", "Which sponsors have we not heard from in 60 days?", "Which investors fit a $10MM JV equity check on a Texas industrial development?"];

/** Very small markdown: paragraphs, bullets, bold, and links (which stay inside the app). */
function render(text: string) {
  const inline = (s: string) => {
    const parts: (string | React.ReactNode)[] = [];
    const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
    let last = 0, m: RegExpExecArray | null, i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[1]) parts.push(m[2].startsWith("/") ? <Link key={i++} href={m[2]} className="text-sky-700 underline">{m[1]}</Link> : <a key={i++} href={m[2]} target="_blank" rel="noreferrer" className="text-sky-700 underline">{m[1]}</a>);
      else parts.push(<b key={i++}>{m[3]}</b>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  const blocks = text.split(/\n{2,}/);
  return blocks.map((b, bi) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) {
      return (
        <ul key={bi} className="my-1 list-disc space-y-0.5 pl-5">
          {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""))}</li>)}
        </ul>
      );
    }
    if (/^#{1,3}\s/.test(lines[0])) return <div key={bi} className="mt-2 font-semibold">{inline(lines[0].replace(/^#+\s*/, ""))}</div>;
    return (
      <p key={bi} className="my-1">
        {lines.map((l, li) => (
          <span key={li}>
            {inline(l)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

export function AskClient({ userName }: { userName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, pending]);

  const send = (q: string) => {
    const text = q.trim();
    if (!text || pending) return;
    const history: ChatMessage[] = [...turns.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
    setTurns((t) => [...t, { role: "user", content: text }]);
    setDraft("");
    start(async () => {
      const r = await askAction(history);
      setTurns((t) => [...t, { role: "assistant", content: r.answer, lookups: r.lookups }]);
    });
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-4xl flex-col px-6 pb-4">
      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {turns.length === 0 && (
          <div className="card p-6">
            <div className="mb-1 flex items-center gap-2 text-base font-semibold">
              <MessageSquare className="h-5 w-5 text-sky-700" /> Ask anything the CRM knows, {userName.split(" ")[0]}
            </div>
            <p className="mb-4 text-sm text-ink-soft">Deals and what is missing on them, who said what on a progress report, a firm&apos;s criteria and history with us, who to call at a company, what is waiting on the Dashboard. Answers come from the CRM&apos;s own records and link back to them. It reads; it does not change anything.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="chip text-sm hover:bg-cream" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-[15px] leading-relaxed ${t.role === "user" ? "bg-ink text-white" : "card"}`}>
              {t.role === "user" ? t.content : render(t.content)}
              {t.lookups && t.lookups.length > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Looked at {t.lookups.length} thing{t.lookups.length === 1 ? "" : "s"}</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {t.lookups.map((l, li) => <li key={li} className="break-all">{l}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="card px-4 py-3 text-sm text-muted">Looking that up…</div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={2}
          placeholder="Ask the CRM… (Enter to send, Shift+Enter for a new line)"
          className="input min-h-[56px] flex-1 resize-none py-3 text-[15px]"
        />
        <button type="submit" className="btn-primary h-[56px] px-4" disabled={pending || !draft.trim()} title="Send">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
