"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TokenEditor, type Token } from "@/components/token-editor";
import { ilMerge } from "@/lib/il-merge";
import { launchIlSend, type IlSendResult } from "../actions";
import type { IlKind, UnitFile } from "../unit";

type R = { id: string; name: string; firstName: string | null; lastName: string | null; company: string | null; email: string };
const mb = (n: number) => `${(n / 1_048_576).toFixed(n >= 1_048_576 ? 1 : 2)} MB`;
const PERSON: Token[] = [
  { key: "contact.firstName|there", label: "First name (or \"there\")", group: "Contact" },
  { key: "contact.firstName", label: "First name", group: "Contact" },
  { key: "contact.lastName", label: "Last name", group: "Contact" },
];

/** The email as it will go, editable in place with the person's name as a token; the files to attach; Launch sends one personal copy per person. */
export function IlSendClient({ kind, id, unitName, recipients, subject: s0, bodyHtml: b0, templates, templateId, files, mailbox, backHref, toParam }: { kind: IlKind; id: string; unitName: string; recipients: R[]; subject: string; bodyHtml: string; templates: { id: string; name: string }[]; templateId: string; files: UnitFile[]; mailbox: string | null; backHref: string; toParam: string }) {
  const router = useRouter();
  const subject = useRef(s0);
  const body = useRef(b0);
  const [tick, setTick] = useState(0);
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
  const first = recipients[0];
  const sample = first ? { firstName: first.firstName, lastName: first.lastName, company: first.company } : { firstName: "there", lastName: null, company: null };
  void tick;
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
      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line bg-cream px-4 py-2 text-sm">
          <span className="text-xs text-muted">Template</span>
          <select value={templateId} onChange={(e) => router.push(`/israel/send/${kind}/${id}/compose?to=${toParam}&template=${e.target.value}`)} className="input py-1 text-xs">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Link href="/israel/templates" className="ml-auto text-xs text-sky-700 hover:underline">
            Edit templates
          </Link>
        </div>
        <div className="flex items-stretch border-b border-line">
          <div className="flex shrink-0 items-center border-r border-line bg-cream-50 px-3 text-xs font-semibold text-muted">Subject</div>
          <TokenEditor key={`s-${templateId}`} value={s0} singleLine tokens={PERSON} className="min-w-0 flex-1 [&>div:first-child]:border-b-0 [&>div:first-child]:bg-transparent" onChange={(v) => { subject.current = v; setTick((t) => t + 1); }} />
        </div>
        <TokenEditor key={`b-${templateId}`} value={b0} tokens={PERSON} className="bg-white" minHeight={360} onChange={(v) => { body.current = v; setTick((t) => t + 1); }} />
        <div className="border-t border-line px-4 py-2 text-xs text-muted">Your name and RJL Israel close the email. Each person gets their own copy with their name in place of the token.</div>
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
          <div className="font-semibold">How {first?.firstName ?? "the first person"} reads the subject</div>
          <div className="mt-1 text-xs text-muted" dangerouslySetInnerHTML={{ __html: ilMerge(subject.current, sample).replace(/<[^>]+>/g, "") || "&nbsp;" }} />
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
            disabled={pending || !mailbox || !recipients.length}
            onClick={() => start(async () => setResult(await launchIlSend({ kind, id, to: recipients.map((r) => r.id), subject: subject.current, html: body.current, files: [...picked] })))}
            className="btn-primary mt-3 w-full justify-center disabled:opacity-50"
          >
            {pending ? `Sending to ${recipients.length}…` : `Launch to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
