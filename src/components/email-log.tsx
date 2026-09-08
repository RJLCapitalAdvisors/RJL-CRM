import Link from "next/link";
import { Mail, MessageSquare, Phone, Users } from "lucide-react";
import { fmtDate } from "@/lib/format";

type Party = { name?: string; address: string };
type Meta = { from?: Party; to?: Party[]; cc?: Party[]; mailbox?: string; hasAttachments?: boolean };
export type EmailRow = { id: string; type: string; subject: string | null; body: string | null; direction: string | null; occurredAt: Date; meta: string | null; contact?: { id: string; firstName: string | null; lastName: string | null } | null; deal?: { id: string; name: string; propertyName: string | null } | null };

const who = (p?: Party) => p?.name?.trim() || p?.address || "";
const list = (ps?: Party[]) => (ps ?? []).map(who).filter(Boolean);
const ICON = { EMAIL: Mail, NOTE: MessageSquare, CALL: Phone, MEETING: Users } as const;

/** Activity feed, HubSpot style: emails (expandable, with who/when/preview) and anything else logged. */
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
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const m: Meta = r.meta ? JSON.parse(r.meta) : {};
            const Icon = ICON[r.type as keyof typeof ICON] ?? MessageSquare;
            const isEmail = r.type === "EMAIL";
            const inbound = r.direction === "INBOUND";
            const to = list(m.to);
            const person = r.contact ? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") : "";
            return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <details>
                  <summary className="flex cursor-pointer items-start gap-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${inbound ? "text-sky-600" : "text-muted"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">
                          {isEmail ? (inbound ? "Incoming email" : "Email") : r.type.charAt(0) + r.type.slice(1).toLowerCase()}
                          {r.subject ? ` - ${r.subject}` : ""}
                        </span>
                        {isEmail && m.from && <span className="text-muted">from {who(m.from)}</span>}
                        {!isEmail && person && <span className="text-muted">{person}</span>}
                        {m.hasAttachments && <span className="text-xs text-muted">(attachments)</span>}
                      </div>
                      {isEmail && to.length > 0 && <div className="text-xs text-muted">to {to.join(", ")}</div>}
                      {!isEmail && r.body && <div className="truncate text-xs text-muted">{r.body}</div>}
                    </div>
                    <span className="shrink-0 text-xs text-muted">{fmtDate(r.occurredAt)}</span>
                  </summary>
                  <div className="ml-7 mt-2 rounded-md border border-line bg-cream-50 px-3 py-2 text-sm">
                    {r.body ? <div className="whitespace-pre-wrap text-ink-soft">{r.body}</div> : <div className="text-muted">No preview.</div>}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                      {r.contact && person && (
                        <Link href={`/contacts/${r.contact.id}`} className="text-sky-600 hover:underline">
                          {person}
                        </Link>
                      )}
                      {r.deal && (
                        <Link href={`/deals/${r.deal.id}`} className="text-sky-600 hover:underline">
                          {r.deal.propertyName ?? r.deal.name}
                        </Link>
                      )}
                      {m.mailbox && <span>via {m.mailbox}</span>}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
