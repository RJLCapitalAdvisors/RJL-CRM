import { EmailLog, type EmailRow } from "@/components/email-log";

type Act = { id: string; type: string; subject: string | null; body: string | null; direction: string | null; occurredAt: Date; externalId: string | null; meta: string | null; contact?: { id: string; firstName: string | null; lastName: string | null } | null };
type Note = { id: string; body: string; createdAt: Date };

/**
 * The Activity window on RJL Israel records: logged emails (from the Israel mailboxes) and typed notes in one
 * list, newest first, in the same inbox-style feed the US side uses. The note form sits above it.
 */
export function IlActivityLog({ activities, notes, form, empty }: { activities: Act[]; notes: Note[]; form?: React.ReactNode; empty: string }) {
  const rows: EmailRow[] = [
    ...activities.map((a) => ({ id: a.id, type: a.type, subject: a.subject, body: a.body, direction: a.direction, occurredAt: a.occurredAt, meta: a.meta, externalId: a.externalId, contact: a.contact ?? null })),
    ...notes.map((n) => ({ id: `note-${n.id}`, type: "NOTE", subject: null, body: n.body, direction: null, occurredAt: n.createdAt, meta: null })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return <EmailLog rows={rows} empty={empty} toolbar={form} />;
}
