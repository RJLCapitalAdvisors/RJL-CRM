import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { mailConfigured } from "@/lib/mailer";
import { currentUser } from "@/lib/current-user";
import { ilBlastStats, parseIlSegment } from "@/lib/il-blasts";
import { deleteIlBlastAction, removeIlRecipientAction } from "../actions";
import { IlBlastPanel } from "./blast-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilCampaign.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: c?.name ?? "Email blast" };
}
export const dynamic = "force-dynamic";

const tone: Record<string, string> = { PENDING: "bg-cream text-ink", SENT: "bg-emerald-100 text-emerald-900", FAILED: "bg-red-100 text-red-900", SKIPPED: "bg-stone-200 text-muted", UNSUBSCRIBED: "bg-stone-200 text-ink" };

/** One RJL Israel blast: the email (editable until sent), a test to yourself, the people, Send now. */
export default async function IlCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, me] = await Promise.all([prisma.ilCampaign.findUnique({ where: { id }, include: { recipients: { orderBy: { id: "asc" }, include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, roles: true, company: { select: { name: true } } } } } } } }), currentUser()]);
  if (!c) notFound();
  const stats = await ilBlastStats(c.id);
  const seg = parseIlSegment(c.segment);
  const from = process.env.IL_MAIL_FROM || process.env.MAIL_FROM || "RJL Israel";
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={`${[seg.roles.length ? seg.roles.join(", ") : "Everyone", seg.city ? `wanting ${seg.city}` : null].filter(Boolean).join(" · ")} · ${stats.total} people · ${c.status.toLowerCase()}${c.sentAt ? ` · sent ${fmtDate(c.sentAt)}` : ""}`}
        actions={
          <>
            <Link href="/israel/campaigns" className="btn-secondary">
              All blasts
            </Link>
            {c.status === "DRAFT" && (
              <form action={deleteIlBlastAction.bind(null, c.id)}>
                <button type="submit" className="btn-ghost text-xs">
                  Delete
                </button>
              </form>
            )}
          </>
        }
      />
      <div className="grid gap-4 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <IlBlastPanel id={c.id} copy={{ subject: c.subject, bodyHtml: c.bodyHtml }} status={c.status} stats={stats} from={from} me={me?.accounts.IL ?? me?.israelEmail ?? me?.email ?? null} configured={mailConfigured()} />
        <div className="card self-start">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">People</div>
            <span className="text-xs text-muted">
              {stats.sent} sent · {stats.pending} to go{stats.failed ? ` · ${stats.failed} failed` : ""}{stats.unsubscribed ? ` · ${stats.unsubscribed} unsubscribed` : ""}
            </span>
          </div>
          <ul className="max-h-[70vh] divide-y divide-line overflow-auto text-sm">
            {c.recipients.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <Link href={`/israel/contacts/${r.contact.id}`} className="truncate font-medium hover:underline">
                    {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email}
                  </Link>
                  <div className="truncate text-xs text-muted">{[r.contact.email, r.contact.company?.name].filter(Boolean).join(" · ")}</div>
                  {r.error && <div className="truncate text-xs text-red-700">{r.error}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={`chip text-[10px] ${tone[r.status] ?? tone.PENDING}`}>{r.status.toLowerCase()}</span>
                  {r.status === "PENDING" && (
                    <form action={removeIlRecipientAction.bind(null, c.id, r.contactId)}>
                      <button type="submit" className="btn-ghost px-1.5 py-0.5 text-xs" title="Leave this person out">
                        ×
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
            {c.recipients.length === 0 && <li className="px-4 py-6 text-center text-muted">Nobody matched. Start a new blast with wider roles.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
