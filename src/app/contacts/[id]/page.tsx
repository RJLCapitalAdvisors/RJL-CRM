import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { RoleChips, Chips } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate, fullName } from "@/lib/format";
import { statusOf } from "@/lib/tracker";
import { addContactNote, updateContact } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.contact.findUnique({ where: { id }, select: { firstName: true, lastName: true, email: true } });
  return { title: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact" : "Contact" };
}

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, users] = await Promise.all([
    prisma.contact.findUnique({
      where: { id },
      include: {
        owner: true,
        company: { include: { criteria: true, _count: { select: { contacts: true } } } },
        criteria: true,
        activities: { orderBy: { occurredAt: "desc" }, take: 50, include: { deal: true } },
        dealRows: { include: { deal: true }, orderBy: { updatedAt: "desc" } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!contact) notFound();
  const update = updateContact.bind(null, contact.id);
  const addNote = addContactNote.bind(null, contact.id);
  const name = fullName(contact);
  const initial = (contact.firstName?.[0] ?? contact.lastName?.[0] ?? contact.email?.[0] ?? "?").toUpperCase();
  const crit = contact.criteria ?? contact.company?.criteria ?? null;

  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/contacts"
            backLabel="Contacts"
            initial={initial}
            title={name}
            subtitle={contact.company?.name}
            lines={[contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null, contact.phone].filter(Boolean)}
            actions={
              <>
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="btn-secondary">
                    Email
                  </a>
                )}
                <RoleChips roles={contact.roles} />
                {contact.unsubscribed && <span className="chip bg-stone-200">Unsubscribed</span>}
                {contact.bounceReason && <span className="chip bg-amber-100">Bounced</span>}
              </>
            }
          />
          <AboutCard title="About this contact">
            <ContactForm contact={contact} users={users} action={update} />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Activity</div>
          <form action={addNote} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a note…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {contact.activities.map((a) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="font-semibold uppercase tracking-wide">
                    {a.type}
                    {a.direction ? ` · ${a.direction.toLowerCase()}` : ""}
                  </span>
                  <span>{fmtDate(a.occurredAt)}</span>
                </div>
                {a.subject && <div className="mt-0.5 font-medium">{a.subject}</div>}
                {a.body && <div className="mt-0.5 whitespace-pre-wrap text-ink-soft">{a.body}</div>}
                {a.deal && (
                  <Link href={`/deals/${a.deal.id}`} className="mt-1 block text-xs text-sky-600 hover:underline">
                    {a.deal.propertyName ?? a.deal.name}
                  </Link>
                )}
              </li>
            ))}
            {contact.activities.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted">
                No activity logged yet. Created {fmtDate(contact.createdAt)}
                {contact.lastActivityAt && <> · last HubSpot activity {fmtDate(contact.lastActivityAt)}</>}. Emails you send appear here once Outlook is connected.
              </li>
            )}
          </ul>
        </div>
      }
      right={
        <>
          <AssocCard title="Companies" count={contact.company ? 1 : 0} empty="No company linked. Pick one in the Company field.">
            {contact.company && (
              <div className="p-4 text-sm">
                <div className="flex items-center gap-2">
                  <Link href={`/companies/${contact.company.id}`} className="font-semibold hover:underline">
                    {contact.company.name}
                  </Link>
                  <span className="chip bg-emerald-100 text-emerald-900">Primary</span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-ink-soft">
                  <div>
                    <span className="text-muted">Roles:</span> <RoleChips roles={contact.company.roles} />
                  </div>
                  <div>
                    <span className="text-muted">Deal location(s):</span> {crit ? <Chips items={crit.geographies} /> : "—"}
                  </div>
                  <div>
                    <span className="text-muted">Asset classes:</span> {crit ? <Chips items={crit.assetClasses} max={4} /> : "—"}
                  </div>
                  <div>
                    <span className="text-muted">Check sizes:</span> {crit ? <Chips items={crit.checkSizes} max={4} /> : "—"}
                  </div>
                  <div>
                    <span className="text-muted">Contacts here:</span> {contact.company._count.contacts}
                  </div>
                </div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Deals" count={contact.dealRows.length} empty="Deals this contact receives will show here with their progress status.">
            {contact.dealRows.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <Link href={`/deals/${r.dealId}/tracker`} className="truncate hover:underline">
                  {r.deal.propertyName ?? r.deal.name}
                </Link>
                <span className="chip whitespace-nowrap text-[11px]" style={{ background: statusOf(r.status).bg, color: statusOf(r.status).c }}>
                  {statusOf(r.status).short}
                </span>
              </div>
            ))}
          </AssocCard>
        </>
      }
    />
  );
}
