"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Paperclip } from "lucide-react";
import { emailBodyAction, openEmailAction, type EmailLinks } from "@/app/email-actions";

export type EmailRowData = {
  id: string;
  subject: string | null;
  preview: string | null;
  inbound: boolean;
  date: string; // preformatted
  from: string;
  to: string[];
  cc: string[];
  hasAttachments: boolean;
  externalId: string | null;
  mailbox: string | null;
  contact?: { id: string; name: string } | null;
  deal?: { id: string; name: string } | null;
};

/** rjlcrm: is the desktop Outlook link type; web is the fallback. */
const desktopHref = (l: Extract<EmailLinks, { ok: true }>) => `rjlcrm:open?mid=${encodeURIComponent(l.messageId)}${l.outlookLink ? `&eid=${l.outlookLink.replace(/^outlook:/, "")}` : ""}`;

/**
 * One email in an activity feed: who wrote to whom and when, the subject, the first lines, then "See more" for
 * the whole message and "Open in Outlook" to jump to it. Notes and calls use the plain row in EmailLog.
 */
export function EmailRow({ e }: { e: EmailRowData }) {
  const [full, setFull] = useState<{ own: string; rest: string } | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [links, setLinks] = useState<Extract<EmailLinks, { ok: true }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const preview = (e.preview ?? "").trim();
  const long = preview.length >= 200 || Boolean(e.externalId);

  const seeMore = () =>
    start(async () => {
      if (!e.externalId) return;
      const r = await emailBodyAction(e.externalId, e.mailbox);
      if (!r) return setErr("Could not load the full email.");
      setFull(r);
    });
  const open = () =>
    start(async () => {
      if (!e.externalId) return;
      const r = await openEmailAction(e.externalId, e.mailbox);
      if (!r.ok) return setErr(r.reason);
      setLinks(r);
      try {
        window.location.href = desktopHref(r);
      } catch {
        /* the buttons below are the sure thing */
      }
    });

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${e.inbound ? "bg-sky/40 text-sky-600" : "bg-cream text-muted"}`} title={e.inbound ? "Received" : "Sent"}>
          {e.inbound ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="truncate text-xs text-muted">
              <span className="font-medium text-ink">{e.from || (e.inbound ? "Them" : "Us")}</span>
              {e.to.length > 0 && <> to {e.to.join(", ")}</>}
              {e.cc.length > 0 && <span className="text-muted"> · cc {e.cc.join(", ")}</span>}
            </div>
            <span className="shrink-0 text-xs text-muted">{e.date}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-medium leading-snug">
            <span className="truncate">{e.subject || "(no subject)"}</span>
            {e.hasAttachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" />}
          </div>
          {full ? (
            <div className="mt-1.5 rounded-md border border-line bg-cream-50 px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
              <div className="whitespace-pre-wrap">{full.own || preview}</div>
              {full.rest && (
                <div className="mt-2 border-t border-line pt-2">
                  <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setShowRest((s) => !s)}>
                    {showRest ? "Hide the earlier messages" : "Show the earlier messages in the thread"}
                  </button>
                  {showRest && <div className="mt-2 whitespace-pre-wrap text-xs text-muted">{full.rest}</div>}
                </div>
              )}
            </div>
          ) : (
            preview && <div className={`mt-1 text-[13px] leading-relaxed text-ink-soft ${long ? "line-clamp-2" : ""}`}>{preview}</div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {!full && e.externalId && (
              <button type="button" className="text-sky-600 hover:underline" disabled={busy} onClick={seeMore}>
                {busy ? "Loading…" : "See more"}
              </button>
            )}
            {full && (
              <button type="button" className="text-muted hover:underline" onClick={() => setFull(null)}>
                See less
              </button>
            )}
            {e.externalId &&
              (links ? (
                <>
                  <a href={desktopHref(links)} className="font-medium text-sky-600 hover:underline">
                    Open in Outlook
                  </a>
                  {links.webLink && (
                    <a href={links.webLink} target="_blank" rel="noreferrer" className="text-muted hover:underline">
                      or Outlook web
                    </a>
                  )}
                </>
              ) : (
                <button type="button" className="text-sky-600 hover:underline" disabled={busy} onClick={open}>
                  Open in Outlook
                </button>
              ))}
            {e.contact && (
              <Link href={`/contacts/${e.contact.id}`} className="text-muted hover:underline">
                {e.contact.name}
              </Link>
            )}
            {e.deal && (
              <Link href={`/deals/${e.deal.id}`} className="text-muted hover:underline">
                {e.deal.name}
              </Link>
            )}
            {e.mailbox && <span className="text-muted">via {e.mailbox.split("@")[0]}</span>}
            {err && <span className="text-red-700">{err}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}
