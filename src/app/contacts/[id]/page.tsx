import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, RoleChips, Chips, Field } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { fmtDate, fullName } from "@/lib/format";
import { addContactNote, updateContact } from "../actions";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, users] = await Promise.all([
    prisma.contact.findUnique({
      where: { id },
      include: {
        owner: true,
        company: { include: { criteria: true } },
        criteria: true,
        activities: { orderBy: { occurredAt: "desc" }, take: 30, include: { deal: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!contact) notFound();

  const update = updateContact.bind(null, contact.id);
  const addNote = addContactNote.bind(null, contact.id);
  const crit = contact.criteria ?? contact.company?.criteria ?? null;

  return (
    <>
      <PageHeader
        title={fullName(contact)}
        subtitle={
          <span className="flex items-center gap-3">
            <RoleChips roles={contact.roles} />
            {contact.company && (
              <Link href={`/companies/${contact.company.id}`} className="hover:underline">
                {contact.company.name}
              </Link>
            )}
            {contact.email && <span>· {contact.email}</span>}
            {contact.unsubscribed && <span className="chip bg-stone-200">Unsubscribed</span>}
            {contact.bounceReason && <span className="chip bg-amber-100">Bounced: {contact.bounceReason}</span>}
          </span>
        }
      />
      <div className="grid grid-cols-3 gap-6 px-8 py-6">
        <div className="col-span-2 space-y-6">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">Details</h2>
            <ContactForm contact={contact} users={users} action={update} />
          </section>
        </div>
        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Investor criteria</h2>
              {contact.company && (
                <Link href={`/companies/${contact.company.id}`} className="text-xs text-sky-600 hover:underline">
                  {contact.criteria ? "Contact-level" : "From company"}
                </Link>
              )}
            </div>
            {crit ? (
              <div className="space-y-3">
                <Field label="Asset classes">
                  <Chips items={crit.assetClasses} />
                </Field>
                <Field label="Check sizes">
                  <Chips items={crit.checkSizes} tone="bg-sky-50 text-ink" />
                </Field>
                <Field label="Investment types">
                  <Chips items={crit.investmentTypes} />
                </Field>
                <Field label="Strategy">{crit.strategy}</Field>
                <Field label="Geographies">
                  <Chips items={crit.geographies} />
                  {crit.geographyNotes && <div className="mt-1 text-xs text-muted">{crit.geographyNotes}</div>}
                </Field>
              </div>
            ) : (
              <div className="text-sm text-muted">No criteria recorded. Add them on the company record.</div>
            )}
          </section>

          <section className="card">
            <div className="border-b border-line px-5 py-3">
              <h2 className="font-semibold">Activity</h2>
            </div>
            <form action={addNote} className="flex gap-2 border-b border-line p-4">
              <input name="body" placeholder="Add a note…" className="input" />
              <button className="btn-secondary" type="submit">
                Add
              </button>
            </form>
            <ul className="divide-y divide-line">
              {contact.activities.map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="font-semibold uppercase tracking-wide">{a.type}</span>
                    <span>{fmtDate(a.occurredAt)}</span>
                  </div>
                  {a.subject && <div className="mt-0.5 font-medium">{a.subject}</div>}
                  {a.body && <div className="mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                  {a.deal && <div className="mt-1 text-xs text-muted">{a.deal.name}</div>}
                </li>
              ))}
              {contact.activities.length === 0 && (
                <li className="px-5 py-6 text-sm text-muted">
                  No activity yet. Created {fmtDate(contact.createdAt)}
                  {contact.lastActivityAt && <> · last HubSpot activity {fmtDate(contact.lastActivityAt)}</>}
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
