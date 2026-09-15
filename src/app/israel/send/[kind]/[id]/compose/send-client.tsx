"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { launchIlSend, type IlSendResult } from "../actions";
import type { IlKind, UnitFile } from "../unit";

type R = { id: string; name: string; email: string };
const mb = (n: number) => `${(n / 1_048_576).toFixed(n >= 1_048_576 ? 1 : 2)} MB`;

/** The email as it will go, editable; the files to attach; Launch sends one personal copy per person from the RJL Israel mailbox. */
export function IlSendClient({ kind, id, unitName, recipients, subject: s0, text: t0, files, mailbox, backHref }: { kind: IlKind; id: string; unitName: string; recipients: R[]; subject: string; text: string; files: UnitFile[]; mailbox: string | null; backHref: string }) {
  const [subject, setSubject] = useState(s0);
  const [text, setText] = useState(t0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(files.map((f) => f.key)));
  const [result, setResult] = useState<IlSendResult | null>(null);
  const [pending, start] = useTransition();
  const total = files.filter((f) => picked.has(f.key)).reduce((a, f) => a + f.size, 0);
  const toggle = (k: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const preview = text.split(/\n{2,}/).map((para, i) => (
    <p key={i} className="mb-2 whitespace-pre-wrap">
      {para.replace(/\{\{\s*first\s*\}\}/g, recipients[0]?.name.split(" ")[0] ?? "there")}
    </p>
  ));
  if (result) {
    return (
      <div className="card max-w-3xl p-5 text-sm">
        <div className="text-base font-semibold">{result.sent ? `Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}` : "Nothing went out"}</div>
        {result.failed.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-red-700">
            {result.failed.map((f) => (
              <li key={f.email}>
                {f.email}: {f.reason}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <Link href={`/israel/${kind}/${id}`} className="btn-primary">
            Back to {unitName}
          </Link>
          <Link href={backHref} className="btn-secondary">
            Send to more people
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="card">
        <div className="border-b border-line px-4 py-3">
          <label className="text-xs text-muted" htmlFor="subj">
            Subject
          </label>
          <input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} className="input mt-1 w-full" />
        </div>
        <div className="grid gap-0 md:grid-cols-2">
          <div className="border-b border-line p-4 md:border-b-0 md:border-r">
            <div className="mb-1 text-xs text-muted">The email. {"{{first}}"} becomes each person&apos;s first name.</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={22} className="input w-full resize-y font-mono text-xs leading-relaxed" />
          </div>
          <div className="p-4 text-sm">
            <div className="mb-1 text-xs text-muted">How {recipients[0]?.name.split(" ")[0] ?? "the first person"} reads it</div>
            <div className="rounded-md border border-line bg-white px-4 py-3">{preview}</div>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="card p-4 text-sm">
          <div className="font-semibold">To</div>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
            {recipients.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span>{r.name}</span>
                <span className="truncate text-muted">{r.email}</span>
              </li>
            ))}
          </ul>
          <Link href={backHref} className="mt-2 inline-block text-xs text-sky-700 hover:underline">
            Change who gets it
          </Link>
        </div>
        <div className="card p-4 text-sm">
          <div className="font-semibold">Files to attach</div>
          {files.length === 0 ? (
            <div className="mt-1 text-xs text-muted">No floorplan or pictures on the ticket yet.</div>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {files.map((f) => (
                <li key={f.key}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={picked.has(f.key)} onChange={() => toggle(f.key)} className="accent-ink" />
                    <span className="truncate">{f.label}</span>
                    <span className="ml-auto text-muted">{mb(f.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {total > 20 * 1_048_576 && <div className="mt-2 text-xs text-amber-700">{mb(total)} attached; keep it under 20 MB so it arrives.</div>}
        </div>
        <div className="card p-4 text-sm">
          <div className="text-xs text-muted">From</div>
          <div className="font-medium">{mailbox ?? "Not signed in to RJL Israel"}</div>
          {!mailbox && <div className="mt-1 text-xs text-amber-700">Click the RJL Israel logo and sign in with your @rjlisrael.com account; the emails go out from that mailbox.</div>}
          <button
            type="button"
            disabled={pending || !mailbox || !recipients.length || !subject.trim() || !text.trim()}
            onClick={() => start(async () => setResult(await launchIlSend({ kind, id, to: recipients.map((r) => r.id), subject, text, files: [...picked] })))}
            className="btn-primary mt-3 w-full justify-center disabled:opacity-50"
          >
            {pending ? `Sending to ${recipients.length}…` : `Launch to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
