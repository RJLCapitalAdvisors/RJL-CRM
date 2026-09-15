"use client";

import { useState, useTransition } from "react";
import { BlastEditor, type BlastCopy } from "@/components/blast-editor";
import { saveIlBlastCopyAction, sendIlBlastNowAction, sendIlTestAction } from "../actions";

type Stats = { total: number; pending: number; sent: number; failed: number; skipped: number; unsubscribed: number };

/** The blast's email (editable while it is a draft), a test to yourself, and Send now. */
export function IlBlastPanel({ id, copy: c0, status, stats, from, me, configured }: { id: string; copy: BlastCopy; status: string; stats: Stats; from: string; me: string | null; configured: boolean }) {
  const [copy, setCopy] = useState(c0);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const draft = status === "DRAFT" || status === "PARTIAL";
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <div>
          <b>{stats.pending}</b> to send · <b>{stats.sent}</b> sent
          {stats.failed ? (
            <>
              {" "}
              · <span className="text-red-700">{stats.failed} failed</span>
            </>
          ) : null}
        </div>
        <span className="ml-auto flex items-center gap-2">
          {note && <span className="text-xs text-muted">{note}</span>}
          {me && (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={pending || !configured} onClick={() => start(async () => setNote(await sendIlTestAction(id)))}>
              Send a test to me
            </button>
          )}
          {draft && stats.pending > 0 && (
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-xs"
              disabled={pending || !configured}
              onClick={() => confirm(`Send this to ${stats.pending} people now?`) && start(async () => setNote(await sendIlBlastNowAction(id)))}
            >
              {pending ? "Sending…" : `Send now to ${stats.pending}`}
            </button>
          )}
        </span>
        {!configured && <div className="w-full text-xs text-amber-700">Email sending is not configured (RESEND_API_KEY and MAIL_FROM).</div>}
      </div>
      <BlastEditor copy={copy} onChange={setCopy} onSave={draft ? (c) => saveIlBlastCopyAction(id, c) : undefined} me={me} from={from} sendTo={<span>{stats.total} people on this blast</span>} />
    </div>
  );
}
