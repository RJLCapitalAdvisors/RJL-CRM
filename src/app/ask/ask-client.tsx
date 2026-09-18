"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Check, FileSpreadsheet, MessageSquare, PanelLeft, Paperclip, Plus, Sparkles, Trash2, X } from "lucide-react";
import { chatAction, deleteThread, importAction, listThreads, loadThread, type StoredMessage, type ThreadSummary, type Workspace } from "./actions";
import type { ImportResult, Proposal } from "@/lib/assistant";

const STARTERS: Record<Workspace, string[]> = {
  CA: ["What is still missing on Woodburn Exchange?", "Which LPs passed on retail deals in Florida this year, and why?", "Who do we talk to at Corebridge now?", "Which sponsors have we not heard from in 60 days?"],
  IL: ["Which apartments in Tel Aviv are under 4 million shekels?", "What is open in the deals funnel this week?", "Who are the agents on the Laguna project?", "Which buyers want 4 rooms in Jerusalem?"],
  AQ: ["Who do I need to call back today?", "Which properties are in the pipeline, by stage?", "Show me every seller in Brooklyn with a phone number.", "Which properties came in this week?"],
};
const INTRO: Record<Workspace, string> = {
  CA: "Deals and what is missing on them, who said what on a progress report, a firm's criteria and history with us, who to call. Answers come from the CRM's own records and link back to them.",
  IL: "Apartments, houses and projects, buyers and what they want, agents and developers, the deals funnel. Answers come from RJL Israel's own records and link back to them.",
  AQ: "Ask about properties, sellers, operators, buyers and the pipeline, or drop a spreadsheet of properties and it reads it in. Tell it how your files work and it remembers.",
};
const RULES_PATH: Record<Workspace, string> = { CA: "/settings/data-rules", IL: "/israel/settings/data-rules", AQ: "/acquisitions/settings/data-rules" };
const ACCEPT = ".xlsx,.xls,.xlsm,.csv,.tsv,.txt";

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
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : s.endsWith("y") ? "" : "s"}`.replace(/propertys$/, "properties").replace(/companys$/, "companies");

/** The rows an answer proposes to add, with the Import button; after Import, what happened and links. */
function ProposalCard({ message, workspace, onImported }: { message: StoredMessage; workspace: Workspace; onImported: (id: string, r: ImportResult, at: string) => void }) {
  const p = message.proposal as Proposal;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const counts = [p.properties?.length ? plural(p.properties.length, "property") : null, p.companies?.length ? plural(p.companies.length, "company") : null, p.contacts?.length ? plural(p.contacts.length, "contact") : null].filter(Boolean).join(", ");
  const r = message.importResult;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-cream-50">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <FileSpreadsheet className="h-3.5 w-3.5 text-sky-700" /> {counts || "Nothing usable"} to add
        </div>
        {message.importedAt ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Imported {when(message.importedAt)}
          </span>
        ) : (
          <button
            type="button"
            disabled={pending || !counts}
            className="btn-primary px-3 py-1 text-xs"
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await importAction(message.id!);
                if (res.ok) onImported(message.id!, res.result, res.importedAt);
                else setError(res.reason);
              })
            }
          >
            {pending ? "Importing…" : "Import"}
          </button>
        )}
      </div>
      {!message.importedAt && (
        <div className="max-h-72 overflow-auto text-xs">
          {p.properties && p.properties.length > 0 && (
            <table className="table dense w-full">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>City</th>
                  <th>St</th>
                  <th>Business</th>
                  <th>Owner</th>
                  <th>Phone</th>
                  <th>Result</th>
                  <th>Linked</th>
                </tr>
              </thead>
              <tbody>
                {p.properties.map((r, i) => (
                  <tr key={i}>
                    <td className="font-medium">{r.address}</td>
                    <td>{r.city}</td>
                    <td>{r.state}</td>
                    <td className="max-w-[140px] truncate">{r.businessName}</td>
                    <td className="max-w-[160px] truncate">{[r.ownerName, r.ownerEntity].filter(Boolean).join(" · ")}</td>
                    <td className="whitespace-nowrap">{r.primaryPhone}</td>
                    <td>{[r.callResult, r.callBackAt].filter(Boolean).join(" · ")}</td>
                    <td className="max-w-[160px] truncate">{[...(r.companies ?? []), ...(r.contacts ?? [])].join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.companies && p.companies.length > 0 && (
            <table className="table dense w-full">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Roles</th>
                  <th>Phone</th>
                  <th>Website</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {p.companies.map((c, i) => (
                  <tr key={i}>
                    <td className="font-medium">{c.name}</td>
                    <td>{c.roles?.join(", ")}</td>
                    <td>{c.phone}</td>
                    <td className="max-w-[160px] truncate">{c.website}</td>
                    <td>{[c.city, c.state].filter(Boolean).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.contacts && p.contacts.length > 0 && (
            <table className="table dense w-full">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Company</th>
                  <th>Roles</th>
                </tr>
              </thead>
              <tbody>
                {p.contacts.map((c, i) => (
                  <tr key={i}>
                    <td className="font-medium">{[c.firstName, c.lastName].filter(Boolean).join(" ")}</td>
                    <td>{c.email}</td>
                    <td>{c.phone}</td>
                    <td>{c.company}</td>
                    <td>{c.roles?.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {r && (
        <div className="px-3 py-2 text-xs">
          <div>
            Added {plural(r.created.properties, "property")}, {plural(r.created.companies, "company")}, {plural(r.created.contacts, "contact")}
            {r.matched.properties + r.matched.companies + r.matched.contacts > 0 && <span className="text-muted">; {r.matched.properties + r.matched.companies + r.matched.contacts} already in the CRM were matched and filled in</span>}.
          </div>
          {r.links.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {r.links.map((l) => (
                <Link key={l.href} href={l.href} className="text-sky-700 hover:underline">
                  {l.label}
                </Link>
              ))}
            </div>
          )}
          {r.skipped.length > 0 && <div className="mt-1 text-muted">{r.skipped.slice(0, 5).join("; ")}</div>}
        </div>
      )}
      {error && <div className="px-3 py-2 text-xs text-red-700">{error}</div>}
      {workspace === "AQ" && !message.importedAt && <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Wrong somewhere? Say so below (&quot;that column is the neighborhood&quot;) and it rereads the file and remembers the rule.</div>}
    </div>
  );
}

/**
 * Ask the CRM, all three sides. A clean centered chat: the text box sits in the middle of an empty chat and moves
 * to the bottom once the conversation starts. Files (spreadsheets, CSV) attach with the clip or by dropping them
 * anywhere on the chat. Conversations are kept per person on the server (left rail, which folds away).
 */
export function AskClient({ userName, initialThreads, initialThreadId, initialMessages, basePath = "/ask", workspace = "CA" }: { userName: string; initialThreads: ThreadSummary[]; initialThreadId: string | null; initialMessages: StoredMessage[]; basePath?: string; workspace?: Workspace }) {
  const router = useRouter();
  const params = useSearchParams();
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [turns, setTurns] = useState<StoredMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rail, setRail] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, pending]);

  // the URL is the source of truth for which chat is open (back button, links from answers)
  const urlThread = params.get("t");
  useEffect(() => {
    if ((urlThread ?? null) === threadId) return;
    if (!urlThread) {
      const t = setTimeout(() => {
        setThreadId(null);
        setTurns([]);
      }, 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      loadThread(urlThread)
        .then((m) => {
          if (cancelled) return;
          setThreadId(urlThread);
          setTurns(m);
        })
        .finally(() => !cancelled && setLoading(false));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlThread]);

  const open = (id: string | null) => router.push(id ? `${basePath}?t=${id}` : basePath);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const ok = Array.from(list).filter((f) => /\.(xlsx|xls|xlsm|csv|tsv|txt)$/i.test(f.name));
    if (ok.length) setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))].slice(0, 6));
  };

  const send = (q: string) => {
    const text = q.trim();
    if ((!text && !files.length) || pending) return;
    const shown = text || `Here ${files.length === 1 ? "is a file" : "are files"}: ${files.map((f) => f.name).join(", ")}`;
    setTurns((t) => [...t, { role: "user", content: shown, attachments: files.map((f) => ({ name: f.name, rows: 0, truncated: false })) }]);
    const fd = new FormData();
    fd.set("text", text);
    for (const f of files) fd.append("files", f);
    setDraft("");
    setFiles([]);
    start(async () => {
      try {
        const r = await chatAction(threadId, workspace, fd);
        setTurns((t) => [...t.slice(0, -1), r.user, r.assistant]);
        if (r.threadId !== threadId) {
          setThreadId(r.threadId);
          window.history.replaceState(null, "", `${basePath}?t=${r.threadId}`);
        }
        setThreads(await listThreads(workspace));
      } catch (e) {
        setTurns((t) => [...t, { role: "assistant", content: `Something went wrong: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` }]);
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("Delete this conversation?")) return;
    start(async () => {
      await deleteThread(id);
      setThreads(await listThreads(workspace));
      if (id === threadId) open(null);
    });
  };

  const onImported = (id: string, result: ImportResult, importedAt: string) => setTurns((t) => t.map((m) => (m.id === id ? { ...m, importResult: result, importedAt } : m)));

  const empty = turns.length === 0 && !loading;
  const composer = (
    <form
      className={`w-full max-w-3xl rounded-2xl border bg-paper shadow-sm transition ${dragging ? "border-sky-600 ring-2 ring-sky/40" : "border-line"}`}
      onSubmit={(e) => {
        e.preventDefault();
        send(draft);
      }}
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {files.map((f) => (
            <span key={f.name + f.size} className="chip inline-flex items-center gap-1 bg-cream text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5 text-sky-700" /> {f.name}
              <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x !== f))} title="Remove" className="text-muted hover:text-ink">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={box}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(draft);
          }
        }}
        rows={empty ? 3 : 2}
        placeholder={workspace === "AQ" ? "Ask about a property, or drop a spreadsheet here…" : "Ask the CRM…"}
        className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <button type="button" onClick={() => fileInput.current?.click()} title="Attach a spreadsheet or CSV" className="btn-ghost inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-ink">
            <Paperclip className="h-4 w-4" /> Attach
          </button>
          <span className="hidden text-[11px] text-muted sm:inline">Enter to send, Shift+Enter for a new line</span>
        </div>
        <button type="submit" className="btn-primary flex h-8 w-8 items-center justify-center rounded-full p-0" disabled={pending || (!draft.trim() && !files.length)} title="Send">
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </form>
  );

  return (
    <div
      className="relative flex h-[calc(100vh-4.5rem)]"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
        box.current?.focus();
      }}
    >
      {/* conversations */}
      {rail && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-paper">
          <div className="flex items-center gap-1 p-3">
            <button type="button" className="btn-secondary flex-1 justify-center" onClick={() => open(null)}>
              <Plus className="h-4 w-4" /> New chat
            </button>
            <button type="button" className="btn-ghost p-2" onClick={() => setRail(false)} title="Hide conversations">
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {threads.length === 0 && <div className="px-2 py-3 text-xs text-muted">Your conversations appear here and stay put.</div>}
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
      )}
      {!rail && (
        <button type="button" className="btn-ghost absolute left-2 top-2 z-10 p-2" onClick={() => setRail(true)} title="Show conversations">
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      {/* the chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sky text-sky-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">What can I look up for you, {userName.split(" ")[0]}?</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">{INTRO[workspace]}</p>
            </div>
            {composer}
            <div className="flex max-w-3xl flex-wrap justify-center gap-2">
              {STARTERS[workspace].map((s) => (
                <button key={s} type="button" className="chip text-sm hover:bg-cream" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
              {loading && <div className="mx-auto max-w-3xl text-sm text-muted">Loading…</div>}
              {turns.map((t, i) => (
                <div key={t.id ?? i} className={`mx-auto max-w-3xl ${t.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
                  {t.role === "user" ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-3 text-[15px] leading-relaxed text-white">
                      {t.content}
                      {t.attachments && t.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.attachments.map((a) => (
                            <span key={a.name} className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs">
                              <FileSpreadsheet className="h-3.5 w-3.5" /> {a.name}
                              {a.rows ? <span className="text-white/70">{a.rows} rows</span> : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex max-w-[92%] gap-3">
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky text-sky-700">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
                        {render(t.content)}
                        {t.savedRules && t.savedRules.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {t.savedRules.map((r) => (
                              <div key={r} className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                  Remembered: {r}{" "}
                                  <Link href={RULES_PATH[workspace]} className="text-emerald-800 underline">
                                    Data rules
                                  </Link>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {t.proposal && t.id && <ProposalCard message={t} workspace={workspace} onImported={onImported} />}
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
                  )}
                </div>
              ))}
              {pending && (
                <div className="mx-auto flex max-w-3xl gap-3">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky text-sky-700">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <div className="py-1 text-sm text-muted">{turns[turns.length - 1]?.attachments?.length ? "Reading the file…" : "Looking that up…"}</div>
                </div>
              )}
              <div ref={bottom} />
            </div>
            <div className="flex justify-center px-6 pb-4">{composer}</div>
          </>
        )}
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-paper/70">
          <div className="rounded-2xl border-2 border-dashed border-sky-600 bg-paper px-8 py-6 text-center shadow">
            <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-sky-700" />
            <div className="font-medium">Drop the spreadsheet here</div>
            <div className="text-xs text-muted">Excel or CSV</div>
          </div>
        </div>
      )}
    </div>
  );
}
