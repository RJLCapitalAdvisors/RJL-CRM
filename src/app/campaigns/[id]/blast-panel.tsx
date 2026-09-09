"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelScheduleAction, scheduleBlastAction, sendBlastNowAction, sendTestBlastAction } from "../actions";

type Stats = { total: number; pending: number; sent: number; opened: number; replied: number; unsubscribed: number; bounced: number; failed: number; skipped: number; followUps: number };

/** The blast's controls: numbers at a glance, schedule or send now, a test to yourself. */
export function BlastPanel({ campaignId, status, scheduledAt, followUpDays, stats, myEmail }: { campaignId: string; status: string; scheduledAt: string | null; followUpDays: string | null; stats: Stats; myEmail: string | null }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [at, setAt] = useState(() => (scheduledAt ? scheduledAt.slice(0, 16) : ""));
  const router = useRouter();
  const done = () => {
    router.refresh();
  };
  const tile = (label: string, n: number, tone = "") => (
    <div className={`rounded-md border border-line px-3 py-2 ${tone}`}>
      <div className="text-lg font-semibold leading-tight">{n.toLocaleString()}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
  const localAt = scheduledAt ? new Date(scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="mx-8 mt-6 space-y-3">
      <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
        {tile("recipients", stats.total)}
        {tile("pending", stats.pending)}
        {tile("sent", stats.sent, "bg-sky-50")}
        {tile("opened", stats.opened)}
        {tile("replied", stats.replied, "bg-emerald-50")}
        {tile("follow-ups", stats.followUps)}
        {tile("unsubscribed", stats.unsubscribed)}
        {tile("bounced / failed", stats.bounced + stats.failed)}
      </div>
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        {status === "SCHEDULED" && localAt ? (
          <>
            <span>
              Scheduled for <b>{localAt}</b>
            </span>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => start(async () => { await cancelScheduleAction(campaignId); setNote("Schedule cancelled; the blast is a draft again."); done(); })}>
              Cancel schedule
            </button>
          </>
        ) : status === "DRAFT" || status === "PARTIAL" ? (
          <>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="input w-56 py-1" />
            <button type="button" className="btn-secondary" disabled={pending || !at} onClick={() => start(async () => { await scheduleBlastAction(campaignId, new Date(at).toISOString()); setNote("Scheduled."); done(); })}>
              Schedule
            </button>
            <button type="button" className="btn-primary" disabled={pending || stats.pending === 0} onClick={() => { if (window.confirm(`Send now to ${stats.pending.toLocaleString()} people?`)) start(async () => { const r = await sendBlastNowAction(campaignId); setNote(r); done(); }); }}>
              {pending ? "Working…" : `Send now to ${stats.pending.toLocaleString()}`}
            </button>
          </>
        ) : (
          <span className="text-muted">{status === "SENDING" ? "Sending…" : "Sent."}</span>
        )}
        <span className="ml-auto text-xs text-muted">Follow-ups: {followUpDays ? `day ${followUpDays.split(",").map((x) => x.trim()).join(" and day ")} to anyone who has not replied` : "none"}</span>
        {myEmail && (
          <button type="button" className="btn-soft" disabled={pending} onClick={() => start(async () => { await sendTestBlastAction(campaignId); setNote(`Test sent to ${myEmail}.`); })}>
            Send a test to me
          </button>
        )}
      </div>
      {note && <div className="text-sm text-muted">{note}</div>}
    </div>
  );
}
