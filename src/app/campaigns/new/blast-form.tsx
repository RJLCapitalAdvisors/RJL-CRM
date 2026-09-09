"use client";

import { useEffect, useState, useTransition } from "react";
import { countSegmentAction, createBlastAction } from "../actions";
import { BlastEditor, type BlastCopy } from "@/components/blast-editor";

type Template = { id: string; name: string; subject: string; bodyHtml: string };

/**
 * New blast, the HubSpot way: the email is the main thing on the page, shown exactly as it will look and editable
 * in place, with a test send at hand. Who gets it, when, and the follow-up cadence sit in the narrow column.
 */
export function BlastForm({ templates, assetClasses, defaultFrom, me }: { templates: Template[]; assetClasses: string[]; defaultFrom: string; me: string | null }) {
  const [audience, setAudience] = useState<"Investor" | "Sponsor" | "All">("Investor");
  const [classes, setClasses] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [copy, setCopy] = useState<BlastCopy>({ subject: templates[0]?.subject ?? "", bodyHtml: templates[0]?.bodyHtml ?? "" });
  const [name, setName] = useState("");
  const [when, setWhen] = useState<"now" | "later">("later");
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T09:00`;
  });
  const [followUps, setFollowUps] = useState(true);
  const [days, setDays] = useState("3, 7");
  const [count, setCount] = useState<{ total: number; sample: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      countSegmentAction({ audience, assetClasses: classes }).then((r) => {
        if (!cancelled) setCount(r);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [audience, classes]);

  const tpl = templates.find((t) => t.id === templateId);
  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    setTemplateId(id);
    if (t) setCopy({ subject: t.subject, bodyHtml: t.bodyHtml });
  };
  const audienceLabel = audience === "All" ? "everyone" : audience === "Investor" ? "investors" : "sponsors";
  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createBlastAction({ name: name.trim() || `${tpl?.name ?? "Blast"} to ${audienceLabel}${classes.length ? ` (${classes.join(", ")})` : ""}`, templateId, segment: { audience, assetClasses: classes }, scheduledAt: when === "later" ? new Date(at).toISOString() : null, followUpDays: followUps ? days.split(/[,\s]+/).map(Number).filter((n) => n > 0) : [], copy });
      if (r && "error" in r) setError(r.error);
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">Who gets it</div>
          <div className="flex flex-wrap gap-2">
            {(["Investor", "Sponsor", "All"] as const).map((a) => (
              <button key={a} type="button" onClick={() => setAudience(a)} className={`rounded-full border px-3 py-1 text-sm ${audience === a ? "border-ink bg-ink text-white" : "border-line bg-paper hover:bg-cream"}`}>
                {a === "Investor" ? "Investors" : a === "Sponsor" ? "Sponsors" : "Everyone"}
              </button>
            ))}
          </div>
          {audience !== "All" && (
            <>
              <div className="mb-1.5 mt-3 text-xs text-muted">Asset classes (empty means all)</div>
              <div className="flex flex-wrap gap-1.5">
                {assetClasses.map((ac) => {
                  const on = classes.includes(ac);
                  return (
                    <button key={ac} type="button" onClick={() => setClasses((s) => (on ? s.filter((x) => x !== ac) : [...s, ac]))} className={`chip text-xs ${on ? "bg-sky" : "bg-cream hover:bg-sky/40"}`}>
                      {ac}
                    </button>
                  );
                })}
              </div>
            </>
          )}
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
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-muted">Picking a template replaces the email on the right. Templates live under Templates (kind: blast).</div>
          <label className="label mt-3" htmlFor="blastName">
            Name (for your records)
          </label>
          <input id="blastName" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder={`${tpl?.name ?? "Blast"} to ${audienceLabel}`} />
        </div>

        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">When</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="when" className="accent-ink" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
          </label>
          {when === "later" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="input mt-1" />}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="radio" name="when" className="accent-ink" checked={when === "now"} onChange={() => setWhen("now")} /> Save as a draft, I will send it from the next screen
          </label>
        </div>

        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">Follow-ups</div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 accent-ink" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} />
            <span>Send again to anyone who has not replied, as a reply on the same subject, after these many days:</span>
          </label>
          {followUps && <input value={days} onChange={(e) => setDays(e.target.value)} className="input mt-2 w-32" placeholder="3, 7" />}
          <div className="mt-1 text-xs text-muted">Stops the moment they reply or unsubscribe.</div>
        </div>

        <div className="card p-4 text-xs text-muted">Sent through Resend on the company domain, so your own mailbox never sends bulk mail. Replies come to your inbox. Every email carries a one-click unsubscribe.</div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <button type="button" className="btn-primary w-full justify-center py-3" disabled={pending || !templateId || !count?.total} onClick={submit}>
          {pending ? "Creating…" : when === "later" ? `Schedule for ${count?.total.toLocaleString() ?? ""} people` : `Create draft for ${count?.total.toLocaleString() ?? ""} people`}
        </button>
      </div>

      <BlastEditor
        copy={copy}
        onChange={setCopy}
        templateKey={templateId}
        me={me}
        from={defaultFrom}
        sendTo={
          count ? (
            <>
              <b>{count.total.toLocaleString()}</b> {audienceLabel}
              {classes.length ? ` in ${classes.join(", ")}` : ""}
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
