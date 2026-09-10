import Link from "next/link";
import { MessageSquare, Phone, Users } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { EmailRow } from "./email-row";

type Party = { name?: string; address: string };
type Meta = { from?: Party; to?: Party[]; cc?: Party[]; mailbox?: string; hasAttachments?: boolean };
export type EmailRow = { id: string; type: string; subject: string | null; body: string | null; direction: string | null; occurredAt: Date; meta: string | null; externalId?: string | null; contact?: { id: string; firstName: string | null; lastName: string | null } | null; deal?: { id: string; name: string; propertyName: string | null } | null };

const who = (p?: Party) => p?.name?.trim() || p?.address || "";
const list = (ps?: Party[]) => (ps ?? []).map(who).filter(Boolean);
const ICON = { NOTE: MessageSquare, CALL: Phone, MEETING: Users } as const;
const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Activity feed for a deal, company or contact. Emails read like an inbox: who to whom, when, the subject, the
 * first lines, then "See more" for the whole message and "Open in Outlook" to jump to it. Notes, calls and
 * meetings are plain rows. The list scrolls inside its window.
 */
export function EmailLog({ rows, title = "Activity", empty, aside, toolbar }: { rows: EmailRow[]; title?: string; empty: string; aside?: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted">{aside ?? rows.length}</span>
      </div>
      {toolbar}
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted">{empty}</div>
      ) : (
        <ul className="max-h-[calc(100vh-230px)] min-h-[320px] divide-y divide-line overflow-y-auto">
          {rows.map((r) => {
            const m: Meta = r.meta ? JSON.parse(r.meta) : {};
            const person = r.contact ? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") : "";
            if (r.type === "EMAIL") {
              const inbound = r.direction === "INBOUND";
              return (
                <EmailRow
                  key={r.id}
                  e={{
                    id: r.id,
                    subject: r.subject,
                    preview: r.body,
                    inbound,
                    date: when(r.occurredAt),
                    from: who(m.from) || (inbound ? person : ""),
                    to: list(m.to),
                    cc: list(m.cc),
                    hasAttachments: Boolean(m.hasAttachments),
                    externalId: r.externalId ?? null,
                    mailbox: m.mailbox ?? null,
                    contact: r.contact && person ? { id: r.contact.id, name: person } : null,
                    deal: r.deal ? { id: r.deal.id, name: r.deal.propertyName ?? r.deal.name } : null,
                  }}
                />
              );
            }
            const Icon = ICON[r.type as keyof typeof ICON] ?? MessageSquare;
            return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cream text-muted">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                      <span>
                        {r.type.charAt(0) + r.type.slice(1).toLowerCase()}
                        {person ? ` · ${person}` : ""}
                      </span>
                      <span className="shrink-0">{fmtDate(r.occurredAt)}</span>
                    </div>
                    {r.subject && <div className="mt-0.5 font-medium">{r.subject}</div>}
                    {r.body && <div className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{r.body}</div>}
                    {r.deal && (
                      <Link href={`/deals/${r.deal.id}`} className="mt-1 inline-block text-xs text-muted hover:underline">
                        {r.deal.propertyName ?? r.deal.name}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
