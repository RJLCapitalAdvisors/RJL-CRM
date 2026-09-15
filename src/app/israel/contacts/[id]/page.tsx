import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate } from "@/lib/format";
import { apartmentLine, ilFullName, nis, parseJsonList } from "@/lib/israel";
import { addIlNote, updateIlContact } from "../../actions";
import { IlContactForm } from "../contact-form";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleChips } from "@/components/il-role-cell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilContact.findUnique({ where: { id }, select: { firstName: true, lastName: true, email: true } });
  return { title: c ? ilFullName(c) : "Contact" };
}

export default async function IlContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, companies] = await Promise.all([
    prisma.ilContact.findUnique({ where: { id }, include: { company: { include: { _count: { select: { contacts: true } } } }, ilNotes: { orderBy: { createdAt: "desc" } }, activities: { orderBy: { occurredAt: "desc" }, take: 200 }, agentOf: { orderBy: { updatedAt: "desc" } }, sellerOf: { orderBy: { updatedAt: "desc" } } } }),
    prisma.ilCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!c) notFound();
  const deals = await prisma.ilDeal.findMany({ where: { OR: [{ buyerContactId: c.id }, { agentContactId: c.id }] }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, stage: true, offerNis: true, apartment: { select: { name: true } } } });
  const name = ilFullName(c);
  const roles = parseJsonList(c.roles);
  const apartments = [...c.agentOf.map((a) => ({ ...a, as: "agent" })), ...c.sellerOf.map((a) => ({ ...a, as: "seller" }))];
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/contacts"
            backLabel="Contacts"
            initial={(c.firstName?.[0] ?? c.lastName?.[0] ?? c.email?.[0] ?? "?").toUpperCase()}
            title={name}
            subtitle={c.company?.name}
            lines={[c.email ? <a key="mail" href={`mailto:${c.email}`}>{c.email}</a> : null, c.phone].filter(Boolean)}
            actions={
              <>
                {c.email && (
                  <a href={`mailto:${c.email}`} className="btn-secondary">
                    Email
                  </a>
                )}
                <IlRoleChips roles={roles} />
              </>
            }
          />
          <AboutCard title="About this contact">
            <IlContactForm c={c} companies={companies} action={updateIlContact.bind(null, c.id)} autosave />
          </AboutCard>
        </>
      }
      center={
        <IlActivityLog
          activities={c.activities}
          notes={c.ilNotes}
          empty={`No activity logged yet. Emails with ${name} from the RJL Israel mailboxes will appear here. Created ${fmtDate(c.createdAt)}.`}
          form={
            <form action={addIlNote.bind(null, { contactId: c.id })} className="flex gap-2 border-b border-line p-3">
              <input name="body" placeholder="Log a call, a viewing, what they said…" className="input" />
              <button className="btn-secondary" type="submit">
                Add
              </button>
            </form>
          }
        />
      }
      right={
        <>
          <AssocCard title="Companies" count={c.company ? 1 : 0} empty="No company linked. Pick one in the Company field.">
            {c.company && (
              <div className="p-4 text-sm">
                <div className="flex items-center gap-2">
                  <Link href={`/israel/companies/${c.company.id}`} className="font-semibold hover:underline">
                    {c.company.name}
                  </Link>
                  <span className="chip bg-emerald-100 text-emerald-900">Primary</span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-ink-soft">
                  <div>
                    <span className="text-muted">Roles:</span> {parseJsonList(c.company.roles).join(", ") || "—"}
                  </div>
                  <div>
                    <span className="text-muted">City:</span> {c.company.city ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted">Contacts here:</span> {c.company._count.contacts}
                  </div>
                </div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Deals" count={deals.length} addHref="/israel/deals/new" empty="Deals this contact is the buyer or the agent on will show here.">
            {deals.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/deals/${d.id}`} className="truncate hover:underline">
                    {d.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{[d.stage, d.apartment?.name].filter(Boolean).join(" · ")}</div>
                </div>
                {d.offerNis && <span className="shrink-0 text-xs tabular-nums">{nis(d.offerNis)}</span>}
              </div>
            ))}
          </AssocCard>
          <AssocCard title="Apartments" count={apartments.length} empty="Apartments this contact sells or represents will show here.">
            {apartments.map((a) => (
              <div key={`${a.as}-${a.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="truncate hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    as {a.as} · {apartmentLine(a)}
                  </div>
                </div>
                {a.priceNis && <span className="shrink-0 text-xs tabular-nums">{nis(a.priceNis)}</span>}
              </div>
            ))}
          </AssocCard>
        </>
      }
    />
  );
}
