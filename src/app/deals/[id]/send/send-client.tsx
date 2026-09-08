"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { hasMarker, withFirstName, withoutName } from "@/lib/first-name-marker";
import { launchAction, previewGeneralEmail, previewToMeAction, reviseGeneralEmailAction } from "./actions";

export type Person = { id: string; name: string; email: string; title: string | null };
export type Firm = { rowId: string; status: number; company: string; domain: string | null; people: Person[]; primaryContactId: string; extraContactIds: string[]; defaultContactIds: string[]; openingLine: string | null; bodyOverride: string | null; draftOpen: boolean };
export type DealFileLite = { key: string; name: string; size: number };
type Draft = { subject: string; html: string; touched: boolean };

const GENERAL = "general";

/**
 * Send deal. Top: the General token, then one token per firm (logo, name, the people it goes to).
 * General is the email with nobody's name in it: edit it (by hand, or by asking the CRM for a change) and every
 * firm's email follows, each with its own person's first name in the greeting. Click a firm to see its email
 * and tweak just that one; click its caret to pick people, x to leave the firm out.
 * Bottom: "Send preview email to me" (the General one goes with a blank greeting) and LAUNCH (each firm gets its own email).
 */
export function SendClient({ dealId, firms, templates, defaultTemplateId, files }: { dealId: string; firms: Firm[]; templates: { id: string; name: string }[]; defaultTemplateId: string; files: DealFileLite[] }) {
  const [chosenFiles, setChosenFiles] = useState<Set<string>>(new Set(files.map((f) => f.key))); // everything the sponsor sent, by default
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [include, setInclude] = useState<Set<string>>(new Set(firms.filter((f) => f.status <= 1).map((f) => f.rowId)));
  const [to, setTo] = useState<Record<string, Set<string>>>(() => Object.fromEntries(firms.map((f) => [f.rowId, new Set((f.extraContactIds.length ? [f.primaryContactId, ...f.extraContactIds] : f.defaultContactIds).filter((id) => f.people.some((p) => p.id === id)))])));
  const [general, setGeneral] = useState<Draft | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); // only firms whose email was edited on its own
  const [current, setCurrent] = useState<string>(GENERAL);
  const [picker, setPicker] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [pending, start] = useTransition();
  const [rendering, setRendering] = useState(false);
  const [reload, setReload] = useState(0); // bump to re-render General from the template
  const [version, setVersion] = useState(0); // bump to push html into the editor (never on keystrokes, so the caret stays put)
  const editor = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const cur = current === GENERAL ? null : firms.find((f) => f.rowId === current) ?? null;
  const primaryFor = (f: Firm) => {
    const set = to[f.rowId] ?? new Set<string>();
    return set.has(f.primaryContactId) ? f.primaryContactId : [...set][0] ?? f.primaryContactId;
  };
  const firstNameOf = (f: Firm) => f.people.find((p) => p.id === primaryFor(f))?.name.split(" ")[0] ?? "";
  /** A firm's email: its own edited version, else the General email with this person's name. */
  const draftFor = (f: Firm): Draft | null => drafts[f.rowId] ?? (general ? { subject: general.subject, html: withFirstName(general.html, firstNameOf(f)), touched: false } : null);
  const shown: Draft | null = cur ? draftFor(cur) : general;

  // the General email, from the template (again when the template changes or after "reset to template")
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => !cancelled && setRendering(true), 0);
    previewGeneralEmail(dealId, templateId)
      .then((r) => {
        if (cancelled) return;
        setGeneral({ subject: r.subject, html: r.html, touched: false });
        setVersion((v) => v + 1);
      })
      .catch(() => null)
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dealId, templateId, reload]);

  // put the html into the editor when the token changes or a fresh version arrives
  useEffect(() => {
    if (editor.current) editor.current.innerHTML = shown?.html ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, version]);

  const commitEdit = () => {
    if (!editor.current) return;
    const html = editor.current.innerHTML;
    if (cur) {
      const base = draftFor(cur);
      setDrafts((s) => (s[cur.rowId]?.html === html ? s : { ...s, [cur.rowId]: { subject: s[cur.rowId]?.subject ?? base?.subject ?? "", html, touched: true } }));
    } else {
      setGeneral((g) => (g && g.html === html ? g : { subject: g?.subject ?? "", html, touched: true }));
    }
  };

  const togglePerson = (rowId: string, pid: string) =>
    setTo((s) => {
      const n = new Set(s[rowId] ?? []);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return { ...s, [rowId]: n };
    });

  const itemsToSend = () =>
    firms
      .filter((f) => include.has(f.rowId) && f.status <= 1)
      .map((f) => {
        const d = draftFor(f);
        return { rowId: f.rowId, toContactIds: [...(to[f.rowId] ?? [])], subject: d?.subject ?? "", html: d?.html ?? "" };
      });

  const launch = () => {
    commitEdit();
    const items = itemsToSend();
    if (!items.length) return;
    if (!general) return setNote("The General email is still rendering.");
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
    const d = cur ? draftFor(cur) : general;
    if (!d?.html) return;
    const html = cur ? d.html : withoutName(d.html);
    start(async () => {
      const r = await previewToMeAction(dealId, { rowId: cur?.rowId ?? GENERAL, toContactIds: cur ? [...(to[cur.rowId] ?? [])] : [], subject: d.subject, html }, [...chosenFiles]);
      setNote(r.ok ? `Preview of the ${cur ? `${cur.company} email` : "General email (no name in the greeting)"} sent to your inbox.` : r.error ?? "Could not send the preview.");
    });
  };

  const revise = () => {
    commitEdit();
    const html = editor.current?.innerHTML ?? general?.html ?? "";
    if (!general || !html || !ask.trim()) return;
    start(async () => {
      const r = await reviseGeneralEmailAction(dealId, general.subject, html, ask);
      if ("error" in r) return setNote(r.error);
      setGeneral({ subject: r.subject, html: r.html, touched: true });
      setDrafts({}); // every firm follows the revised General email
      setVersion((v) => v + 1);
      setAsk("");
      setNote(hasMarker(r.html) ? "Revised. Every firm's email now follows this version." : "Revised, but the greeting lost its name slot: each email will open with 'Hi there'. Reset to template if that is not what you want.");
    });
  };

  const setSubject = (value: string) => {
    if (cur) {
      const base = draftFor(cur);
      setDrafts((s) => ({ ...s, [cur.rowId]: { subject: value, html: s[cur.rowId]?.html ?? base?.html ?? "", touched: true } }));
    } else setGeneral((g) => ({ subject: value, html: g?.html ?? "", touched: true }));
  };

  const resetShown = () => {
    if (cur) {
      setDrafts((s) => {
        const n = { ...s };
        delete n[cur.rowId];
        return n;
      });
      setVersion((v) => v + 1);
    } else {
      setDrafts({});
      setReload((n) => n + 1);
    }
  };

  const pill = (selected: boolean, on = true) => `flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-1 text-sm ${selected ? "border-sky-600 bg-sky" : on ? "border-line bg-paper" : "border-line bg-cream-50 opacity-60"}`;

  return (
    <div className="mx-auto max-w-[1000px] space-y-4 px-6 py-5">
      {/* recipients */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>
            Sending individually to {include.size} firm{include.size === 1 ? "" : "s"}. General is everyone&apos;s starting point; click a firm to see and tweak its own email; the arrow picks people; x leaves it out.
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
          <div className={`${pill(current === GENERAL)} min-w-[480px] pr-3`}>
            <button type="button" className="flex w-full items-center gap-2" onClick={() => setCurrent(GENERAL)} title="The email everyone gets, with no name in the greeting. Edit it once here.">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ink text-white">
                <PenLine className="h-3 w-3" />
              </span>
              <span className="font-medium">General</span>
              <span className="text-xs text-muted">{general?.touched ? "edited here, so every firm's email follows" : "the one email everyone gets; edit it once here"}</span>
            </button>
          </div>
          {firms.map((f) => {
            const on = include.has(f.rowId) && f.status <= 1;
            const chosen = f.people.filter((p) => (to[f.rowId] ?? new Set()).has(p.id));
            const res = results[f.rowId];
            const selected = current === f.rowId;
            return (
              <div key={f.rowId} className="relative">
                <div className={`${pill(selected, on)} ${res?.ok ? "border-emerald-500" : ""}`}>
                  <button type="button" className="flex items-center gap-1.5" onClick={() => setCurrent(f.rowId)} title={f.status >= 2 ? "Already sent" : "Show this firm's email"}>
                    <CompanyLogo domain={f.domain} name={f.company} size={18} />
                    <span className="font-medium">{f.company}</span>
                    <span className="text-xs text-muted">{chosen.length ? chosen.map((p) => p.name.split(" ")[0]).join(", ") : "nobody picked"}</span>
                    {drafts[f.rowId] && !res && <span className="text-xs text-sky-700" title="This firm's email was edited on its own">edited</span>}
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

      {/* the email: General, or the selected firm's */}
      <div className="card">
        <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            {cur ? <CompanyLogo domain={cur.domain} name={cur.company} size={18} /> : <PenLine className="h-4 w-4" />}
            <span className="font-semibold">{cur ? `Email to ${cur.company}` : "General email"}</span>
            {cur ? (
              <span className="text-xs text-muted">to {cur.people.filter((p) => (to[cur.rowId] ?? new Set()).has(p.id)).map((p) => p.email).join(", ") || "nobody picked"}</span>
            ) : (
              <span className="text-xs text-muted">no name in the greeting; each firm gets this with its person&apos;s first name</span>
            )}
          </div>
          {shown?.touched && (
            <button type="button" className="text-xs text-muted hover:underline" onClick={resetShown}>
              {cur ? "back to the General email" : "reset to template"}
            </button>
          )}
        </div>
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="w-14 text-xs text-muted">Subject</span>
            <input value={shown?.subject ?? ""} onChange={(e) => setSubject(e.target.value)} className="input py-1" />
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
          {!cur && (
            <div className="mt-3 flex items-start gap-2">
              <textarea
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                rows={2}
                placeholder="Ask the CRM to change this email, e.g. emphasize the business plan more, shorten the sponsor background, lead with the yield on cost"
                className="input min-h-[44px] flex-1 resize-y py-1.5 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    revise();
                  }
                }}
              />
              <button type="button" className="btn-secondary" disabled={pending || !general || !ask.trim()} onClick={revise} title="Claude edits the General email as asked; every firm's email follows">
                {pending ? "Working…" : "Revise"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="text-sm text-muted">{note ?? `${itemsToSend().length} email${itemsToSend().length === 1 ? "" : "s"} ready. Each firm gets the General email with its person's name, the ${chosenFiles.size} attachment${chosenFiles.size === 1 ? "" : "s"} ticked above and your signature.`}</div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" disabled={pending || !shown?.html} onClick={previewToMe} title={cur ? "Emails you the exact message this firm would get" : "Emails you the General email, with no name in the greeting"}>
            Send preview email to me
          </button>
          <button type="button" className="btn-primary px-5" disabled={pending || itemsToSend().length === 0 || !general} onClick={launch}>
            {pending ? "Working…" : "LAUNCH"}
          </button>
        </div>
      </div>
    </div>
  );
}
