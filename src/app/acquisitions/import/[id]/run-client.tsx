"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";
import type { RunReport } from "@/lib/aq-import-runs";
import type { Override } from "@/lib/aq-import-build";
import { answerImportProperty, deleteImportRun, setImportOverride } from "../actions";

export type ReviewRow = {
  key: string; n: number; address: string; city: string; business: string | null; crmId: string | null; crmNote: string | null; hint: string[];
  read: boolean; outcome: "live" | "junk" | "hold" | null; list: "deal" | "pipeline" | null; callResult: string | null; callBackDate: string | null; junkReason: string | null;
  question: string | null; guess: string | null; why: string | null; by: string | null; override: string | null; answer: string | null; effects: string[];
  tags: string[]; lastCall: string; dialed: number; numbers: number; junkNumbers: number; people: string[]; owner: string | null;
  calls: { number: string; who: string; when: string; disposition: string; tags: string[]; notes: string[]; transcript: string | null; junk: boolean }[];
};

type Filter = "all" | "hold" | "deal" | "pipeline" | "callback" | "junk" | "skipped" | "other";
const FILTERS: { key: Filter; label: string; test: (r: ReviewRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "hold", label: "Needs you", test: (r) => r.outcome === "hold" },
  { key: "deal", label: "Deals board", test: (r) => r.outcome === "live" && r.list === "deal" },
  { key: "pipeline", label: "Deals Pipeline", test: (r) => r.outcome === "live" && r.list === "pipeline" },
  { key: "callback", label: "Callbacks", test: (r) => r.outcome === "live" && !r.list && r.callResult === "Callback" },
  { key: "junk", label: "Junk", test: (r) => r.outcome === "junk" },
  { key: "skipped", label: "Skipped", test: (r) => r.outcome === "live" && r.callResult === "Skipped" },
  { key: "other", label: "Everything else", test: (r) => r.outcome === "live" && !r.list && r.callResult !== "Callback" && r.callResult !== "Skipped" },
];
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

function Outcome({ r }: { r: ReviewRow }) {
  const b = (tone: string, text: string) => <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{text}</span>;
  if (!r.read) return b("bg-cream text-muted", "Reading…");
  if (r.outcome === "hold") return b("bg-amber-100 text-amber-800", "Needs you");
  if (r.outcome === "junk") return b("bg-red-100 text-red-700", `Junk${r.junkReason ? `: ${r.junkReason}` : ""}`);
  if (r.list === "deal") return b("bg-emerald-100 text-emerald-800", "Deals board");
  if (r.list === "pipeline") return b("bg-violet-100 text-violet-800", `Deals Pipeline${r.callResult && r.callResult !== "Deal" ? ` · ${r.callResult}` : ""}`);
  if (r.callResult === "Callback") return b("bg-sky-100 text-sky-800", `Callback ${day(r.callBackDate)}`);
  if (r.callResult) return b("bg-cream text-ink", r.callResult);
  return b("bg-cream text-muted", "No change");
}

export function RunClient({ id, status, fileName, readDone, importDone, total, rows, report, ignored, error }: { id: string; status: string; fileName: string; readDone: number; importDone: number; total: number; rows: ReviewRow[]; report: RunReport | null; ignored: { row: number; why: string }[]; error: string | null }) {
  const router = useRouter();
  const [progress, setProgress] = useState({ read: readDone, wrote: importDone });
  const [failure, setFailure] = useState<string | null>(null);
  const [writing, setWriting] = useState(status === "IMPORTING");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const running = useRef(false);

  // reading: step after step until every property has a reading (resumes if the page was closed half way)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (status !== "READING" || running.current) return;
    running.current = true;
    (async () => {
      for (let tries = 0; alive.current; ) {
        const res = await fetch(`/api/acquisitions/import/${id}/read`, { method: "POST" });
        const r = (await res.json().catch(() => ({}))) as { done?: number; status?: string; error?: string; busy?: boolean };
        if (!res.ok) {
          if (++tries >= 3) {
            setFailure(r.error ?? "Reading stopped.");
            break;
          }
          continue;
        }
        tries = 0;
        setProgress((p) => ({ ...p, read: r.done ?? p.read }));
        // another tab or an earlier request is on a step: wait for it
        if (r.busy) await new Promise((ok) => setTimeout(ok, 5000));
        if (r.status !== "READING") {
          router.refresh();
          break;
        }
      }
      running.current = false;
    })();
  }, [status, id, router]);

  const write = async () => {
    setWriting(true);
    setFailure(null);
    let from = progress.wrote;
    for (let tries = 0; ; ) {
      const res = await fetch(`/api/acquisitions/import/${id}/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from }) });
      const r = (await res.json().catch(() => ({}))) as { done?: number; status?: string; error?: string; busy?: boolean };
      if (!res.ok) {
        if (++tries >= 3) {
          setFailure(r.error ?? "The import stopped. Click Import again to carry on where it left off.");
          setWriting(false);
          return;
        }
        continue;
      }
      tries = 0;
      if (r.busy) await new Promise((ok) => setTimeout(ok, 5000));
      from = r.done ?? from;
      setProgress((p) => ({ ...p, wrote: from }));
      if (r.status === "DONE") break;
    }
    router.refresh();
  };

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);
  const shown = rows.filter(FILTERS.find((f) => f.key === filter)!.test);
  const setOverride = (key: string, o: Override | null) => start(async () => {
    await setImportOverride(id, key, o);
    router.refresh();
  });
  const editable = status === "REVIEW";

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 pt-5">
      {(failure || (error && status === "READING")) && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {failure ?? error}
            {failure && status === "READING" && (
              <button className="ml-2 underline" onClick={() => location.reload()}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {status === "READING" && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-sky-700" /> Claude is reading the calls: {progress.read} of {total} properties
          </div>
          <Bar done={progress.read} total={total} />
          <div className="mt-2 text-xs text-muted">A few properties at a time with your Import instructions. You can leave this page; it carries on when you come back.</div>
        </div>
      )}

      {status === "DONE" && report && <Report report={report} fileName={fileName} />}

      {status !== "READING" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-full border px-2.5 py-1 text-xs ${filter === f.key ? "border-sky-700 bg-sky-700 text-white" : "border-line bg-paper text-ink hover:border-sky-400"} ${f.key === "hold" && counts.hold ? "font-semibold" : ""}`}>
                {f.label} <span className="opacity-70">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {editable && counts.hold > 0 && filter !== "hold" && (
            <button onClick={() => setFilter("hold")} className="block w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900">
              <b>{counts.hold} {counts.hold === 1 ? "property needs" : "properties need"} your answer.</b> Answer here before importing, or import now and they wait on the dashboard&apos;s Waiting on Shawn list.
            </button>
          )}

          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line bg-cream">
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2 font-medium">Property</th>
                  <th className="px-2 py-2 font-medium">What happens</th>
                  <th className="px-2 py-2 font-medium">Why</th>
                  <th className="px-2 py-2 font-medium">Calls</th>
                  {editable && <th className="px-2 py-2 font-medium">Change</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const isOpen = open.has(r.key);
                  return (
                    <Fragment key={r.key}>
                      <tr className={`border-b border-line align-top ${r.outcome === "hold" ? "bg-amber-50/50" : ""}`}>
                        <td className="px-2 py-2">
                          <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} className="text-muted hover:text-ink" aria-label="Details">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium">
                            {r.crmId ? (
                              <Link href={`/acquisitions/properties/${r.crmId}`} className="text-sky-700 hover:underline">
                                {r.address}
                              </Link>
                            ) : (
                              r.address
                            )}
                            <span className="font-normal text-muted">, {r.city}</span>
                          </div>
                          <div className="text-xs text-muted">
                            {r.business ?? "no business named"} · <span className={r.crmId ? "" : "text-emerald-700"}>{r.crmId ? `update (${r.crmNote})` : "new"}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <Outcome r={r} />
                          {r.override && <div className="mt-0.5 text-[11px] text-muted">changed by you</div>}
                          {r.effects.map((x) => (
                            <div key={x} className="mt-0.5 text-[11px] text-ink">
                              {x}
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-2 text-xs leading-5">
                          {r.outcome === "hold" && r.question ? <div className="font-medium text-amber-900">{r.question}</div> : null}
                          {r.answer && (
                            <div className="mb-0.5 text-sky-900">
                              <b>Your answer:</b> {r.answer}
                            </div>
                          )}
                          <div className="text-muted">{r.why}</div>
                          {r.outcome === "hold" && editable && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {(["junk", "pipeline", "deal", "live"] as const).map((g) => (
                                <button key={g} disabled={pending} onClick={() => setOverride(r.key, { outcome: g })} className={`rounded border px-2 py-0.5 text-[11px] ${r.guess === g ? "border-amber-600 bg-amber-600 text-white" : "border-line bg-paper hover:border-amber-500"}`}>
                                  {g === "junk" ? "Junk" : g === "pipeline" ? "Deals Pipeline" : g === "deal" ? "Deals board" : "Keep live"}
                                  {r.guess === g ? " (my guess)" : ""}
                                </button>
                              ))}
                            </div>
                          )}
                          {r.outcome === "hold" && editable && <AnswerBox id={id} rowKey={r.key} placeholder="Or tell me what to do, e.g. put the owner on my Operators Pipeline and keep the property live" />}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">
                          {r.dialed ? `${r.dialed} of ${r.numbers} dialed` : `${r.numbers} numbers, none dialed`}
                          {r.junkNumbers ? <div className="text-red-700">{r.junkNumbers} to Junk Numbers</div> : null}
                          {r.tags.length ? <div className="mt-0.5 max-w-[180px] whitespace-normal">{r.tags.map((t) => `[${t}]`).join(" ")}</div> : null}
                        </td>
                        {editable && (
                          <td className="px-2 py-2">
                            <select
                              disabled={pending || !r.read}
                              value={r.override ?? ""}
                              onChange={(e) => {
                                const v = e.target.value as Override["outcome"] | "";
                                if (!v) return setOverride(r.key, null);
                                const junkReason = v === "junk" ? window.prompt("Why is it junk?", r.junkReason ?? "") ?? undefined : undefined;
                                setOverride(r.key, { outcome: v, junkReason: junkReason || undefined });
                              }}
                              className="input py-0.5 text-xs"
                            >
                              <option value="">As read</option>
                              <option value="live">Keep live</option>
                              <option value="pipeline">Deals Pipeline</option>
                              <option value="deal">Deals board</option>
                              <option value="junk">Junk</option>
                            </select>
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line bg-cream-50">
                          <td></td>
                          <td colSpan={editable ? 5 : 4} className="px-2 py-3 text-xs">
                            <Details r={r} />
                            {editable && r.read && r.outcome !== "hold" && (
                              <div className="mt-3 max-w-2xl">
                                <AnswerBox id={id} rowKey={r.key} placeholder="Tell me what to do differently, e.g. add Joe as an operator contact, not on the pipeline" />
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">
                      Nothing here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {ignored.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">{ignored.length} file rows were not phone numbers or had no address (their properties still count)</summary>
              <ul className="mt-1 list-disc pl-5">
                {ignored.slice(0, 200).map((x) => (
                  <li key={x.row}>
                    Row {x.row}: {x.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {(status === "REVIEW" || status === "IMPORTING") && (
        <div className="sticky bottom-0 z-20 -mx-6 border-t border-line bg-paper/95 px-6 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="min-w-0 flex-1 text-sm">
              {writing ? (
                <>
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-sky-700" /> Writing {progress.wrote} of {total} properties…
                  </div>
                  <Bar done={progress.wrote} total={total} />
                </>
              ) : (
                <span>
                  <b>{total} properties</b> ready{counts.hold ? <>; {counts.hold} unanswered go to Waiting on Shawn</> : null}. Nothing is written until you click Import.
                </span>
              )}
            </div>
            {!writing && status === "REVIEW" && (
              <button
                className="text-muted hover:text-red-700"
                title="Discard this import (nothing in the CRM changes)"
                onClick={() => {
                  if (confirm("Discard this import? Nothing in the CRM changes.")) start(async () => {
                    await deleteImportRun(id);
                    router.push("/acquisitions/import");
                  });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button className="btn-primary" disabled={writing || pending} onClick={() => void write()}>
              {writing ? "Importing…" : status === "IMPORTING" ? "Carry on importing" : `Import ${total} properties`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-cream">
      <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
    </div>
  );
}

/** Shawn's own words on one property: Claude reads it again with them as the instruction and the row updates. */
function AnswerBox({ id, rowKey, placeholder }: { id: string; rowKey: string; placeholder: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await answerImportProperty(id, rowKey, text).catch((e) => ({ ok: false as const, reason: String(e instanceof Error ? e.message : e) }));
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setText("");
    router.refresh();
  };
  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        disabled={busy}
        rows={2}
        placeholder={placeholder}
        className="input w-full resize-y text-xs"
      />
      <div className="mt-1 flex items-center gap-2">
        <button className="btn-secondary py-0.5 text-xs" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? "Reading your answer…" : "Apply"}
        </button>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-700" />}
        {error && <span className="text-[11px] text-red-700">{error}</span>}
        {!busy && !error && <span className="text-[11px] text-muted">Claude re-reads this property with your words. Nothing is written until Import.</span>}
      </div>
    </div>
  );
}

function Details({ r }: { r: ReviewRow }) {
  return (
    <div className="grid gap-3 md:grid-cols-[220px_1fr]">
      <div className="space-y-1.5">
        <div>
          <span className="text-muted">Owner entity:</span> {r.owner ?? "none"}
        </div>
        <div>
          <span className="text-muted">People:</span> {r.people.join(", ") || "no names in the file"}
        </div>
        <div>
          <span className="text-muted">Last call:</span> {r.lastCall || "never dialed"}
        </div>
        {r.hint.length > 0 && (
          <div>
            <span className="text-muted">Possible duplicate:</span>
            <ul className="list-disc pl-4">
              {r.hint.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-muted">Read by {r.by === "rule" ? "rule (nothing to judge)" : r.by === "fallback" ? "nobody (held so nothing is lost)" : "Claude"}</div>
      </div>
      <div className="space-y-2">
        {r.calls.length ? (
          r.calls.map((c, i) => (
            <div key={i} className="rounded border border-line bg-paper p-2">
              <div className="flex flex-wrap gap-x-2">
                <span className={`font-medium ${c.junk ? "text-red-700 line-through" : ""}`}>{c.number}</span>
                <span className="text-muted">{c.who}</span>
                <span>{c.disposition}</span>
                <span className="text-muted">{c.when}</span>
                {c.tags.length > 0 && <span className="text-sky-800">{c.tags.map((t) => `[${t}]`).join(" ")}</span>}
                {c.junk && <span className="text-red-700">→ Junk Phone Numbers</span>}
              </div>
              {c.notes.map((n, j) => (
                <div key={j} className="mt-1">
                  <span className="text-muted">Note:</span> {n}
                </div>
              ))}
              {c.transcript && <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-muted">{c.transcript}</div>}
            </div>
          ))
        ) : (
          <div className="text-muted">No calls on this property in the file.</div>
        )}
      </div>
    </div>
  );
}

function Report({ report, fileName }: { report: RunReport; fileName: string }) {
  const c = report.check;
  const clean = c && !c.missing.length && !report.errors.length;
  return (
    <div className="space-y-3">
      {c && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${clean ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          {clean ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />}
          <div className="text-sm">
            <div className="font-semibold">
              {c.inFile} properties in {fileName} → {c.live} live in the CRM · {c.junk} in Junk · {c.waiting} waiting on you{c.missing.length ? ` · ${c.missing.length} missing` : ""}
            </div>
            {clean ? (
              <div className="text-emerald-900">Every property in the file is accounted for.</div>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-red-900">
                {c.missing.map((m) => (
                  <li key={m.address + m.city}>
                    {m.address}, {m.city}: {m.why}
                  </li>
                ))}
                {report.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        {[
          ["Properties", `${report.properties.new} new, ${report.properties.updated} updated, ${report.properties.junked} to Junk, ${report.properties.skipped} Skipped`],
          ["People", `${report.contacts.new} new, ${report.contacts.updated} updated`],
          ["Companies", `${report.companies.new} new, ${report.companies.updated} updated`],
          ["Numbers and history", `${report.numbersJunked} numbers to Junk, ${report.notes} notes, ${report.transcripts} transcripts`],
        ].map(([t, d]) => (
          <div key={t} className="card p-3">
            <div className="text-xs text-muted">{t}</div>
            <div className="font-medium">{d}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 text-xs md:grid-cols-3">
        <List title="Deal lists and pipelines" items={report.pipeline} />
        <List title="Callbacks" items={report.callbacks} />
        <List title={`Waiting on Shawn (${report.waiting.length})`} items={report.waiting.map((w) => `${w.address}: ${w.question}`)} link={{ href: "/acquisitions", label: "Answer on the dashboard" }} />
      </div>
      {report.unsure.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">{report.unsure.length} notes from the importer</summary>
          <ul className="mt-1 list-disc pl-5">
            {report.unsure.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function List({ title, items, link }: { title: string; items: string[]; link?: { href: string; label: string } }) {
  return (
    <div className="card p-3">
      <div className="mb-1 flex items-center justify-between font-semibold">
        {title}
        {link && items.length > 0 && (
          <Link href={link.href} className="font-normal text-sky-700 hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {items.length ? (
        <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <div className="text-muted">None.</div>
      )}
    </div>
  );
}
