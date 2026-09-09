"use client";

import { useEffect, useState, useTransition } from "react";
import { countSegmentAction, createBlastAction } from "../actions";

type Template = { id: string; name: string; subject: string };

/**
 * New blast: who (investors, sponsors, everyone; optionally by asset class), what (a blast template), when
 * (now or a date and time), and the follow-up cadence. The count updates as you change the audience.
 */
export function BlastForm({ templates, assetClasses, defaultFrom }: { templates: Template[]; assetClasses: string[]; defaultFrom: string }) {
  const [audience, setAudience] = useState<"Investor" | "Sponsor" | "All">("Investor");
  const [classes, setClasses] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [when, setWhen] = useState<"now" | "later">("later");
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(9, 0, 0, 0);
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
  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createBlastAction({ name: name.trim() || `${tpl?.name ?? "Blast"} to ${audience === "All" ? "everyone" : audience === "Investor" ? "investors" : "sponsors"}${classes.length ? ` (${classes.join(", ")})` : ""}`, templateId, segment: { audience, assetClasses: classes }, scheduledAt: when === "later" ? new Date(at).toISOString() : null, followUpDays: followUps ? days.split(/[,\s]+/).map(Number).filter((n) => n > 0) : [] });
      if (r && "error" in r) setError(r.error);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold">Who gets it</div>
          <div className="flex flex-wrap gap-2">
            {(["Investor", "Sponsor", "All"] as const).map((a) => (
              <button key={a} type="button" onClick={() => setAudience(a)} className={`rounded-full border px-4 py-1.5 text-sm ${audience === a ? "border-ink bg-ink text-white" : "border-line bg-paper hover:bg-cream"}`}>
                {a === "Investor" ? "Investors" : a === "Sponsor" ? "Sponsors" : "Everyone"}
              </button>
            ))}
          </div>
          {audience !== "All" && (
            <>
              <div className="mb-2 mt-4 text-xs text-muted">Asset classes (leave empty for all)</div>
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
          <div className="mt-4 text-sm">
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

        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold">What goes out</div>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="input">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {tpl && <div className="mt-2 text-xs text-muted">Subject: {tpl.subject}</div>}
          <div className="mt-2 text-xs text-muted">You can edit the subject and body on the next screen before anything goes out. Templates are managed under Templates (kind: blast).</div>
          <div className="mt-3">
            <label className="label" htmlFor="blastName">
              Name (for your records)
            </label>
            <input id="blastName" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder={`${tpl?.name ?? "Blast"} to ${audience === "All" ? "everyone" : audience === "Investor" ? "investors" : "sponsors"}`} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold">When</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="when" className="accent-ink" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
          </label>
          {when === "later" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="input mt-1" />}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="radio" name="when" className="accent-ink" checked={when === "now"} onChange={() => setWhen("now")} /> Save as a draft, I will send it from the next screen
          </label>
        </div>
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold">Follow-ups</div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 accent-ink" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} />
            <span>Send the same email again to anyone who has not replied, as a reply on the same subject, after these many days:</span>
          </label>
          {followUps && <input value={days} onChange={(e) => setDays(e.target.value)} className="input mt-2 w-32" placeholder="3, 7" />}
          <div className="mt-2 text-xs text-muted">Stops the moment they reply or unsubscribe. Two steps by default: day 3 and day 7.</div>
        </div>
        <div className="card p-5 text-sm">
          <div className="mb-1 font-semibold">From</div>
          <div className="text-ink-soft">{defaultFrom}</div>
          <div className="mt-1 text-xs text-muted">Sent through Resend on the company domain, so your own mailbox never sends bulk mail. Replies come to your inbox. Every email carries a one-click unsubscribe.</div>
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <button type="button" className="btn-primary w-full justify-center py-3" disabled={pending || !templateId || !count?.total} onClick={submit}>
          {pending ? "Creating…" : when === "later" ? `Schedule for ${count?.total.toLocaleString() ?? ""} people` : `Create draft for ${count?.total.toLocaleString() ?? ""} people`}
        </button>
      </div>
    </div>
  );
}
