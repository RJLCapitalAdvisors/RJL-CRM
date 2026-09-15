"use client";

import { useEffect, useState, useTransition } from "react";
import { BlastEditor, type BlastCopy } from "@/components/blast-editor";
import { countIlSegmentAction, createIlBlastAction } from "../actions";

type Template = { id: string; name: string; subject: string; bodyHtml: string };

/** New RJL Israel blast: roles and a city on the left, the email itself on the right, exactly as it will look. */
export function IlBlastForm({ templates, roles, from, me }: { templates: Template[]; roles: string[]; from: string; me: string | null }) {
  const [picked, setPicked] = useState<string[]>(["Buyer"]);
  const [city, setCity] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [copy, setCopy] = useState<BlastCopy>({ subject: templates[0]?.subject ?? "", bodyHtml: templates[0]?.bodyHtml ?? "" });
  const [name, setName] = useState("");
  const [count, setCount] = useState<{ total: number; sample: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      countIlSegmentAction({ roles: picked, city: city.trim() || null }).then((r) => {
        if (!cancelled) setCount(r);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [picked, city]);

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    setTemplateId(id);
    if (t) setCopy({ subject: t.subject, bodyHtml: t.bodyHtml });
  };
  const who = `${picked.length ? picked.join(", ") : "everyone"}${city.trim() ? ` wanting ${city.trim()}` : ""}`;
  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createIlBlastAction({ name: name.trim() || `${copy.subject || "Blast"} to ${who}`, subject: copy.subject, bodyHtml: copy.bodyHtml, segment: { roles: picked, city: city.trim() || null }, templateId: templateId || null });
      if (r && "error" in r) setError(r.error);
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">Who gets it</div>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => {
              const on = picked.includes(r);
              return (
                <button key={r} type="button" onClick={() => setPicked((s) => (on ? s.filter((x) => x !== r) : [...s, r]))} className={`chip text-xs ${on ? "bg-ink text-paper" : "bg-cream hover:bg-sky/40"}`}>
                  {r}
                </button>
              );
            })}
            {picked.length > 0 && (
              <button type="button" onClick={() => setPicked([])} className="chip bg-cream text-xs text-muted hover:bg-sky/40">
                Everyone
              </button>
            )}
          </div>
          <label className="label mt-3" htmlFor="blastCity">
            Wanting a city (optional)
          </label>
          <input id="blastCity" value={city} onChange={(e) => setCity(e.target.value)} className="input" placeholder="Jerusalem" />
          <div className="mt-3 text-sm">
            {count ? (
              <>
                <b>{count.total.toLocaleString()}</b> people
                {count.sample.length > 0 && <span className="text-muted"> · e.g. {count.sample.join(", ")}</span>}
              </>
            ) : (
              <span className="text-muted">Counting…</span>
            )}
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">Start from</div>
          <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} className="input">
            {templates.map((t) => (
              <option key={t.id || "starter"} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-muted">RJL Israel blast templates show here once there are some; the blank starter is always there.</div>
          <label className="label mt-3" htmlFor="blastName">
            Name (for your records)
          </label>
          <input id="blastName" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder={`${copy.subject || "Blast"} to ${who}`} />
        </div>
        <div className="card p-4 text-xs text-muted">Saved as a draft first. On the next screen: a test to yourself, the list of people, then Send now. Every email carries a one-click unsubscribe.</div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <button type="button" className="btn-primary w-full justify-center py-3" disabled={pending || !count?.total} onClick={submit}>
          {pending ? "Creating…" : `Create draft for ${count?.total.toLocaleString() ?? ""} people`}
        </button>
      </div>
      <BlastEditor
        copy={copy}
        onChange={setCopy}
        templateKey={templateId}
        me={me}
        from={from}
        sendTo={
          count ? (
            <>
              <b>{count.total.toLocaleString()}</b> {who}
              {count.sample.length > 0 && <span className="text-muted"> · e.g. {count.sample.join(", ")}</span>}
            </>
          ) : (
            <span className="text-muted">Counting…</span>
          )
        }
      />
    </div>
  );
}
