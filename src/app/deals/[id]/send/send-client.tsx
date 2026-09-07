"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSendDraftsAction, previewDealEmail } from "./actions";

export type Person = { id: string; name: string; email: string; title: string | null };
export type Firm = { rowId: string; status: number; company: string; people: Person[]; primaryContactId: string; extraContactIds: string[]; openingLine: string | null; bodyOverride: string | null; draftOpen: boolean };
type Links = { webLink: string; outlookLink: string | null; messageId: string | null };
const desktopHref = (l: Links) => (l.messageId ? `rjlcrm:open?mid=${encodeURIComponent(l.messageId)}` : l.outlookLink ?? l.webLink);

/**
 * Left: every agreed firm with the people at it (tick who gets the email), a personal first line, and an
 * optional custom body. Right: live preview of the selected firm's email. Bottom: create the drafts in
 * Outlook, then open them one after another.
 */
export function SendClient({ dealId, firms, templates, defaultTemplateId }: { dealId: string; firms: Firm[]; templates: { id: string; name: string }[]; defaultTemplateId: string }) {
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [include, setInclude] = useState<Set<string>>(new Set(firms.filter((f) => f.status <= 1).map((f) => f.rowId)));
  const [to, setTo] = useState<Record<string, Set<string>>>(() => Object.fromEntries(firms.map((f) => [f.rowId, new Set([f.primaryContactId, ...f.extraContactIds])])));
  const [opening, setOpening] = useState<Record<string, string>>(() => Object.fromEntries(firms.map((f) => [f.rowId, f.openingLine ?? "hope you are well."])));
  const [bodies, setBodies] = useState<Record<string, string | null>>(() => Object.fromEntries(firms.map((f) => [f.rowId, f.bodyOverride])));
  const [current, setCurrent] = useState<string | null>(firms.find((f) => f.status <= 1)?.rowId ?? firms[0]?.rowId ?? null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [links, setLinks] = useState<Record<string, Links | { error: string }>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cur = firms.find((f) => f.rowId === current) ?? null;
  const curTo = cur ? [...(to[cur.rowId] ?? [])] : [];
  const curPrimary = cur ? (curTo.includes(cur.primaryContactId) ? cur.primaryContactId : curTo[0] ?? cur.primaryContactId) : null;

  useEffect(() => {
    if (!cur || !curPrimary || !templateId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => previewDealEmail(dealId, templateId, curPrimary, opening[cur.rowId] ?? null, bodies[cur.rowId] ?? null).then(setPreview).catch(() => setPreview(null)), 300);
  }, [cur, curPrimary, templateId, opening, bodies, dealId]);

  const togglePerson = (rowId: string, pid: string) =>
    setTo((s) => {
      const n = new Set(s[rowId] ?? []);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return { ...s, [rowId]: n };
    });

  const create = () =>
    start(async () => {
      const items = firms.filter((f) => include.has(f.rowId)).map((f) => ({ rowId: f.rowId, toContactIds: [...(to[f.rowId] ?? [])], openingLine: opening[f.rowId] ?? null, bodyOverride: bodies[f.rowId] ?? null }));
      const r = await createSendDraftsAction(dealId, templateId, items);
      if (!r.ok) return setLinks({ __all: { error: r.reason } });
      const next: Record<string, Links | { error: string }> = {};
      for (const x of r.results) next[x.rowId] = x.result.ok ? { webLink: x.result.webLink, outlookLink: x.result.outlookLink, messageId: x.result.messageId } : { error: x.result.reason };
      setLinks(next);
      router.refresh();
    });

  const ready = Object.values(links).filter((l) => !("error" in l)).length;

  return (
    <div className="grid gap-5 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <label className="text-muted">Template</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="input w-80">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="ml-auto text-muted">
            {include.size} firm{include.size === 1 ? "" : "s"} selected
          </span>
          <button type="button" className="btn-primary" disabled={pending || include.size === 0} onClick={create}>
            {pending ? "Creating drafts…" : ready ? "Recreate drafts" : "Create drafts in Outlook"}
          </button>
        </div>
        {"__all" in links && "error" in links.__all && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{(links.__all as { error: string }).error}</div>}

        <div className="card divide-y divide-line">
          {firms.map((f) => {
            const link = links[f.rowId];
            const selected = f.rowId === current;
            return (
              <div key={f.rowId} className={`px-4 py-3 ${selected ? "bg-cream-50" : ""}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 accent-ink" checked={include.has(f.rowId)} disabled={f.status >= 2} onChange={() => setInclude((s) => { const n = new Set(s); if (n.has(f.rowId)) n.delete(f.rowId); else n.add(f.rowId); return n; })} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCurrent(f.rowId)}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{f.company}</span>
                      {f.status >= 2 && <span className="text-xs text-muted">sent</span>}
                      {f.draftOpen && f.status < 2 && <span className="text-xs text-muted">draft in Outlook</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {f.people.map((p) => (
                        <label key={p.id} className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="accent-ink" checked={(to[f.rowId] ?? new Set()).has(p.id)} onChange={() => togglePerson(f.rowId, p.id)} />
                          <span>{p.name}</span>
                          {p.title && <span className="text-xs text-muted">{p.title}</span>}
                        </label>
                      ))}
                      {f.people.length === 0 && <span className="text-xs text-red-700">nobody with an email at this firm</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted">Hi {f.people.find((p) => p.id === f.primaryContactId)?.name.split(" ")[0] ?? "…"} -</span>
                      <input value={opening[f.rowId] ?? ""} onChange={(e) => setOpening((s) => ({ ...s, [f.rowId]: e.target.value }))} className="input max-w-md py-1 text-sm" placeholder="hope you are well." onClick={(e) => e.stopPropagation()} />
                    </div>
                  </button>
                  <div className="shrink-0 text-right">
                    {link && !("error" in link) && (
                      <a href={desktopHref(link)} className="btn-soft" title="Open this draft in Outlook to review and send">
                        Open
                      </a>
                    )}
                    {link && "error" in link && <div className="max-w-[200px] text-xs text-red-700">{link.error}</div>}
                  </div>
                </div>
              </div>
            );
          })}
          {firms.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">No groups on this deal yet. Finalize the engagement letter first.</div>}
        </div>
      </div>

      <div className="card self-start">
        <div className="border-b border-line bg-cream px-4 py-3 text-sm font-semibold">Preview{cur ? `: ${cur.company}` : ""}</div>
        {cur && (
          <div className="px-4 py-3 text-sm">
            <div className="mb-2 text-xs text-muted">To: {cur.people.filter((p) => (to[cur.rowId] ?? new Set()).has(p.id)).map((p) => p.email).join(", ") || "nobody picked"}</div>
            <div className="mb-3 font-medium">{preview?.subject ?? "…"}</div>
            <div className="max-h-[60vh] overflow-auto rounded-md border border-line bg-white p-3" dangerouslySetInnerHTML={{ __html: preview?.html ?? "<p style='color:#888'>Rendering…</p>" }} />
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer hover:underline">Customize the body for {cur.company} only</summary>
              <textarea className="input mt-2 min-h-[160px] font-mono text-xs" value={bodies[cur.rowId] ?? ""} onChange={(e) => setBodies((s) => ({ ...s, [cur.rowId]: e.target.value || null }))} placeholder="Leave empty to use the template. Tokens like {{deal.intro}} and {{contact.firstName}} still work here." />
            </details>
          </div>
        )}
        {ready > 0 && <div className="border-t border-line px-4 py-3 text-xs text-muted">{ready} draft{ready === 1 ? "" : "s"} waiting in your Outlook. Click Open on each, glance, send. Rows flip to Deal Sent on the progress report as they go out.</div>}
      </div>
    </div>
  );
}
