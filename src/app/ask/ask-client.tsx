"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import { askAction, deleteThread, listThreads, loadThread, type StoredMessage, type ThreadSummary } from "./actions";

const STARTERS = ["What is still missing on Woodburn Exchange?", "Which LPs passed on retail deals in Florida this year, and why?", "Who do we talk to at Corebridge now?", "Summarize the investor feedback on Palm Beach County Retail.", "Which sponsors have we not heard from in 60 days?", "What were the terms on the last deal we closed?"];

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
  return text.split(/\n{2,}/).map((b, bi) => {
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

const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Ask the CRM. Conversations are kept per person on the server (left column), so leaving the page and coming
 * back, or opening a link from an answer, never loses a chat. ?t=<thread> in the URL points at the open one.
 */
export function AskClient({ userName, initialThreads, initialThreadId, initialMessages }: { userName: string; initialThreads: ThreadSummary[]; initialThreadId: string | null; initialMessages: StoredMessage[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [turns, setTurns] = useState<StoredMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, pending]);

  // the URL is the source of truth for which chat is open (back button, links from answers)
  const urlThread = params.get("t");
  useEffect(() => {
    if ((urlThread ?? null) === threadId) return;
    if (!urlThread) {
      setThreadId(null);
      setTurns([]);
      return;
    }
    setLoading(true);
    loadThread(urlThread)
      .then((m) => {
        setThreadId(urlThread);
        setTurns(m);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlThread]);

  const open = (id: string | null) => router.push(id ? `/ask?t=${id}` : "/ask");

  const send = (q: string) => {
    const text = q.trim();
    if (!text || pending) return;
    setTurns((t) => [...t, { role: "user", content: text }]);
    setDraft("");
    start(async () => {
      const r = await askAction(threadId, text);
      setTurns((t) => [...t, { role: "assistant", content: r.answer, lookups: r.lookups }]);
      if (r.threadId !== threadId) {
        setThreadId(r.threadId);
        window.history.replaceState(null, "", `/ask?t=${r.threadId}`);
      }
      setThreads(await listThreads());
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("Delete this conversation?")) return;
    start(async () => {
      await deleteThread(id);
      setThreads(await listThreads());
      if (id === threadId) open(null);
    });
  };

  return (
    <div className="flex h-[calc(100vh-4.5rem)]">
      {/* conversations */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-paper">
        <div className="p-3">
          <button type="button" className="btn-secondary w-full justify-center" onClick={() => open(null)}>
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {threads.length === 0 && <div className="px-2 py-3 text-xs text-muted">Your conversations will appear here and stay put.</div>}
          {threads.map((t) => (
            <div key={t.id} className={`group mb-0.5 flex items-start gap-1 rounded-md px-2 py-1.5 text-sm ${t.id === threadId ? "bg-sky" : "hover:bg-cream"}`}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(t.id)} title={t.title}>
                <div className="truncate">{t.title}</div>
                <div className="text-[11px] text-muted">{when(t.updatedAt)}</div>
              </button>
              <button type="button" className="mt-0.5 hidden shrink-0 text-muted hover:text-red-700 group-hover:block" onClick={() => remove(t.id)} title="Delete this conversation">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* the chat */}
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-4">
        <div className="flex-1 space-y-4 overflow-y-auto py-4">
          {turns.length === 0 && !loading && (
            <div className="card mx-auto max-w-3xl p-6">
              <div className="mb-1 flex items-center gap-2 text-base font-semibold">
                <MessageSquare className="h-5 w-5 text-sky-700" /> Ask anything the CRM knows, {userName.split(" ")[0]}
              </div>
              <p className="mb-4 text-sm text-ink-soft">Deals and what is missing on them, who said what on a progress report, a firm&apos;s criteria and history with us, who to call at a company, what is waiting on the Dashboard, the terms on a closed deal. Answers come from the CRM&apos;s own records and link back to them. It reads; it does not change anything.</p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" className="chip text-sm hover:bg-cream" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {loading && <div className="mx-auto max-w-3xl text-sm text-muted">Loading…</div>}
          {turns.map((t, i) => (
            <div key={i} className={`mx-auto max-w-3xl ${t.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
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
            <div className="mx-auto flex max-w-3xl justify-start">
              <div className="card px-4 py-3 text-sm text-muted">Looking that up…</div>
            </div>
          )}
          <div ref={bottom} />
        </div>
        <form
          className="mx-auto flex w-full max-w-3xl items-end gap-2"
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
    </div>
  );
}
