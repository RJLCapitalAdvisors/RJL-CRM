"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CompanyLogo } from "@/components/company-logo";
import { launchAction, previewDealEmail, previewToMeAction } from "./actions";

export type Person = { id: string; name: string; email: string; title: string | null };
export type Firm = { rowId: string; status: number; company: string; domain: string | null; people: Person[]; primaryContactId: string; extraContactIds: string[]; defaultContactIds: string[]; openingLine: string | null; bodyOverride: string | null; draftOpen: boolean };
export type DealFileLite = { key: string; name: string; size: number };
type Draft = { subject: string; html: string; touched: boolean };

/**
 * Send deal. Top: one token per firm (logo, name, the people it goes to); click a token to work on that
 * firm's email, click its caret to pick people, x to leave the firm out. Middle: the email for the selected
 * firm, editable in place. Bottom: "Send preview email" (to you) and LAUNCH (each firm gets its own email, all at once).
 */
export function SendClient({ dealId, firms, templates, defaultTemplateId, files }: { dealId: string; firms: Firm[]; templates: { id: string; name: string }[]; defaultTemplateId: string; files: DealFileLite[] }) {
  const [chosenFiles, setChosenFiles] = useState<Set<string>>(new Set(files.map((f) => f.key))); // everything the sponsor sent, by default
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [include, setInclude] = useState<Set<string>>(new Set(firms.filter((f) => f.status <= 1).map((f) => f.rowId)));
  const [to, setTo] = useState<Record<string, Set<string>>>(() => Object.fromEntries(firms.map((f) => [f.rowId, new Set((f.extraContactIds.length ? [f.primaryContactId, ...f.extraContactIds] : f.defaultContactIds).filter((id) => f.people.some((p) => p.id === id)))])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [current, setCurrent] = useState<string | null>(firms.find((f) => f.status <= 1)?.rowId ?? firms[0]?.rowId ?? null);
  const [picker, setPicker] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [rendering, setRendering] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const cur = firms.find((f) => f.rowId === current) ?? null;
  const primaryFor = (f: Firm) => {
    const set = to[f.rowId] ?? new Set<string>();
    return set.has(f.primaryContactId) ? f.primaryContactId : [...set][0] ?? f.primaryContactId;
  };

  // render the selected firm's email once (or when the template changes); edits are kept in `drafts`
  useEffect(() => {
    if (!cur) return;
    const d = drafts[cur.rowId];
    if (d && d.touched) return;
    let cancelled = false;
    const t = setTimeout(() => !cancelled && setRendering(true), 0); // async so the effect itself does not set state
    previewDealEmail(dealId, templateId, primaryFor(cur), cur.openingLine ?? "hope you are well.", null)
      .then((r) => {
        if (!cancelled) setDrafts((s) => ({ ...s, [cur.rowId]: { subject: r.subject, html: r.html, touched: false } }));
      })
      .catch(() => null)
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, templateId]);

  // put the html into the editor whenever the selected draft changes
  useEffect(() => {
    if (editor.current && cur && drafts[cur.rowId]) editor.current.innerHTML = drafts[cur.rowId].html;
  }, [current, drafts[cur?.rowId ?? ""]?.html === undefined, templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitEdit = () => {
    if (!cur || !editor.current) return;
    const html = editor.current.innerHTML;
    setDrafts((s) => (s[cur.rowId] && s[cur.rowId].html === html ? s : { ...s, [cur.rowId]: { subject: s[cur.rowId]?.subject ?? "", html, touched: true } }));
  };

  const togglePerson = (rowId: string, pid: string) =>
    setTo((s) => {
      const n = new Set(s[rowId] ?? []);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return { ...s, [rowId]: n };
    });

  const itemsToSend = () => firms.filter((f) => include.has(f.rowId) && f.status <= 1).map((f) => ({ rowId: f.rowId, toContactIds: [...(to[f.rowId] ?? [])], subject: drafts[f.rowId]?.subject ?? "", html: drafts[f.rowId]?.html ?? "" }));
  const unrendered = () => itemsToSend().filter((i) => !i.html).length;

  const launch = () => {
    commitEdit();
    const items = itemsToSend();
    if (!items.length) return;
    if (unrendered()) return setNote("Click each firm once so its email is rendered before launching.");
    if (!window.confirm(`Send ${items.length} individual email${items.length === 1 ? "" : "s"} now, each to the people picked?`)) return;
    start(async () => {
      const r = await launchAction(dealId, items, [...chosenFiles]);
      if (!r.ok) return setNote(r.reason);
      setResults(Object.fromEntries(r.results.map((x) => [x.rowId, { ok: x.ok, error: x.error }])));
      const sent = r.results.filter((x) => x.ok).length;
      setNote(`${sent} of ${r.results.length} sent. Rows are now Deal Sent on the progress report.`);
      router.refresh();
    });
  };

  const previewToMe = () => {
    commitEdit();
    if (!cur) return;
    const d = drafts[cur.rowId];
    if (!d?.html) return;
    start(async () => {
      const r = await previewToMeAction(dealId, { rowId: cur.rowId, toContactIds: [...(to[cur.rowId] ?? [])], subject: d.subject, html: d.html }, [...chosenFiles]);
      setNote(r.ok ? `Preview of the ${cur.company} email sent to your inbox.` : r.error ?? "Could not send the preview.");
    });
  };

  return (
    <div className="mx-auto max-w-[1000px] space-y-4 px-6 py-5">
      {/* recipients */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>
            Sending individually to {include.size} firm{include.size === 1 ? "" : "s"}. Click a firm to see and edit its email; click the arrow to pick people; x leaves it out.
          </span>
          <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setDrafts({}); }} className="input w-64 py-1 text-xs" title="Template">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {firms.map((f) => {
            const on = include.has(f.rowId) && f.status <= 1;
            const chosen = f.people.filter((p) => (to[f.rowId] ?? new Set()).has(p.id));
            const res = results[f.rowId];
            const selected = current === f.rowId;
            return (
              <div key={f.rowId} className="relative">
                <div className={`flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-1 text-sm ${selected ? "border-sky-600 bg-sky" : on ? "border-line bg-paper" : "border-line bg-cream-50 opacity-60"} ${res?.ok ? "border-emerald-500" : ""}`}>
                  <button type="button" className="flex items-center gap-1.5" onClick={() => setCurrent(f.rowId)} title={f.status >= 2 ? "Already sent" : "Show this firm's email"}>
                    <CompanyLogo domain={f.domain} name={f.company} size={18} />
                    <span className="font-medium">{f.company}</span>
                    <span className="text-xs text-muted">{chosen.length ? chosen.map((p) => p.name.split(" ")[0]).join(", ") : "nobody picked"}</span>
                    {res?.ok && <span className="text-xs text-emerald-700">sent</span>}
                    {res && !res.ok && <span className="text-xs text-red-700" title={res.error}>failed</span>}
                    {f.status >= 2 && !res && <span className="text-xs text-muted">sent earlier</span>}
                  </button>
                  {f.status <= 1 && (
                    <>
                      <button type="button" className="rounded-full px-1 text-xs text-muted hover:bg-cream" onClick={() => setPicker(picker === f.rowId ? null : f.rowId)} title="Pick who at this firm gets it">
                        ▾
                      </button>
                      <button type="button" className="rounded-full px-1 text-xs text-muted hover:bg-cream" onClick={() => setInclude((s) => { const n = new Set(s); if (n.has(f.rowId)) n.delete(f.rowId); else n.add(f.rowId); return n; })} title={on ? "Leave this firm out" : "Include this firm"}>
                        {on ? "×" : "+"}
                      </button>
                    </>
                  )}
                </div>
                {picker === f.rowId && (
                  <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-line bg-paper p-2 shadow-lg">
                    <div className="mb-1 text-xs text-muted">Who at {f.company} gets it</div>
                    {f.people.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-cream">
                        <input type="checkbox" className="accent-ink" checked={(to[f.rowId] ?? new Set()).has(p.id)} onChange={() => togglePerson(f.rowId, p.id)} />
                        <span className="min-w-0 flex-1 truncate">
                          {p.name} <span className="text-xs text-muted">{p.title ?? p.email}</span>
                        </span>
                      </label>
                    ))}
                    {f.people.length === 0 && <div className="text-xs text-red-700">Nobody with an email at this firm.</div>}
                    <button type="button" className="mt-1 text-xs text-sky-600 hover:underline" onClick={() => setPicker(null)}>
                      done
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {firms.length === 0 && <span className="text-sm text-muted">No groups on this deal yet. Finalize the engagement letter first.</span>}
        </div>
      </div>

      {/* attachments: only what the sponsor sent us on this deal */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
        <span className="text-xs text-muted">Attachments</span>
        {files.length === 0 && <span className="text-xs text-muted">No files from the sponsor on this deal yet (they arrive through deals@).</span>}
        {files.map((f) => (
          <label key={f.key} className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" className="accent-ink" checked={chosenFiles.has(f.key)} onChange={() => setChosenFiles((s) => { const n = new Set(s); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })} />
            <span>{f.name}</span>
            <span className="text-xs text-muted">{f.size >= 1_000_000 ? `${(f.size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1000))} KB`}</span>
          </label>
        ))}
      </div>

      {/* the email for the selected firm */}
      <div className="card">
        <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            {cur && <CompanyLogo domain={cur.domain} name={cur.company} size={18} />}
            <span className="font-semibold">{cur ? `Email to ${cur.company}` : "Pick a firm above"}</span>
            {cur && <span className="text-xs text-muted">to {cur.people.filter((p) => (to[cur.rowId] ?? new Set()).has(p.id)).map((p) => p.email).join(", ") || "nobody picked"}</span>}
          </div>
          {cur && drafts[cur.rowId]?.touched && (
            <button type="button" className="text-xs text-muted hover:underline" onClick={() => setDrafts((s) => { const n = { ...s }; delete n[cur.rowId]; return n; })}>
              reset to template
            </button>
          )}
        </div>
        {cur && (
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="w-14 text-xs text-muted">Subject</span>
              <input value={drafts[cur.rowId]?.subject ?? ""} onChange={(e) => setDrafts((s) => ({ ...s, [cur.rowId]: { subject: e.target.value, html: s[cur.rowId]?.html ?? "", touched: true } }))} className="input py-1" />
            </div>
            <div
              ref={editor}
              contentEditable
              suppressContentEditableWarning
              onBlur={commitEdit}
              onInput={commitEdit}
              className="min-h-[420px] rounded-md border border-line bg-white p-4 text-[11pt] outline-none focus:border-sky-600"
              style={{ fontFamily: "Calibri, Arial, sans-serif" }}
            />
            {rendering && <div className="mt-1 text-xs text-muted">Rendering…</div>}
          </div>
        )}
      </div>

      {/* actions */}
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="text-sm text-muted">{note ?? `${itemsToSend().length} email${itemsToSend().length === 1 ? "" : "s"} ready. Each firm gets its own, with the ${chosenFiles.size} attachment${chosenFiles.size === 1 ? "" : "s"} ticked above and your signature.`}</div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" disabled={pending || !cur || !drafts[cur.rowId]?.html} onClick={previewToMe} title="Emails you the exact message the selected firm would get">
            Send preview email to me
          </button>
          <button type="button" className="btn-primary px-5" disabled={pending || itemsToSend().length === 0} onClick={launch}>
            {pending ? "Working…" : "LAUNCH"}
          </button>
        </div>
      </div>
    </div>
  );
}
