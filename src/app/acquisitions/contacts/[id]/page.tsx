import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleCell } from "@/components/il-role-cell";
import { CompanyLogo } from "@/components/company-logo";
import { AQ_ROLES, aqFullName, aqStageTone, parseJsonList, propertyLine } from "@/lib/acquisitions";
import { addAqNote, deleteAqContact, setAqContactRoles, updateAqContact } from "../../actions";
import { AqContactForm } from "../contact-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.aqContact.findUnique({ where: { id }, select: { firstName: true, lastName: true, email: true } });
  return { title: c ? aqFullName(c) : "Contact" };
}

export default async function AqContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, companies] = await Promise.all([
    prisma.aqContact.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, domain: true, website: true, roles: true, _count: { select: { contacts: true } } } },
        aqNotes: { orderBy: { createdAt: "desc" } },
        activities: { orderBy: { occurredAt: "desc" }, take: 200 },
        properties: { include: { property: { select: { id: true, address: true, neighborhood: true, city: true, state: true, stages: true } } } },
      },
    }),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!c) notFound();
  const name = aqFullName(c);
  const noteForm = (
    <form action={addAqNote.bind(null, { contactId: c.id })} className="flex gap-2">
      <input name="body" placeholder="Add a note" className="input flex-1 py-1 text-sm" />
      <button type="submit" className="btn-secondary px-3 text-xs">
        Note
      </button>
    </form>
  );
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/acquisitions/contacts"
            backLabel="Contacts"
            initial={(c.firstName?.[0] ?? c.lastName?.[0] ?? c.email?.[0] ?? "?").toUpperCase()}
            title={name}
            subtitle={c.company?.name}
            lines={[c.email ? <a key="mail" href={`mailto:${c.email}`}>{c.email}</a> : null, c.phone ? <a key="tel" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a> : null].filter(Boolean)}
            actions={
              <>
                {c.email && (
                  <a href={`mailto:${c.email}`} className="btn-secondary">
                    Email
                  </a>
                )}
                <IlRoleCell roles={c.roles} options={AQ_ROLES} action={setAqContactRoles.bind(null, c.id)} />
                <form action={deleteAqContact.bind(null, c.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          <AboutCard title="About this contact">
            <AqContactForm c={c} companies={companies} action={updateAqContact.bind(null, c.id)} autosave />
          </AboutCard>
        </>
      }
      center={<IlActivityLog activities={c.activities} notes={c.aqNotes} form={noteForm} empty="No emails or notes yet. Emails to and from this person in the Acquisitions mailbox appear here." />}
      right={
        <>
          <AssocCard title="Company" count={c.company ? 1 : 0} addHref="/acquisitions/companies/new" addLabel="New company" empty="Pick the company in the form on the left.">
            {c.company && (
              <div className="flex items-center gap-3 p-4 text-sm">
                <CompanyLogo domain={c.company.domain ?? c.company.website?.replace(/^https?:\/\//, "").split("/")[0]} name={c.company.name} size={28} />
                <div className="min-w-0">
                  <Link href={`/acquisitions/companies/${c.company.id}`} className="font-semibold hover:underline">
                    {c.company.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {parseJsonList(c.company.roles).join(", ") || "no role yet"} · {c.company._count.contacts} contact{c.company._count.contacts === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Properties" count={c.properties.length} addHref="/acquisitions/properties/new" addLabel="New property" empty="Link this person from a property's page.">
            <ul className="divide-y divide-line text-sm">
              {c.properties.map(({ property: p }) => (
                <li key={p.id} className="px-4 py-2">
                  <Link href={`/acquisitions/properties/${p.id}`} className="font-medium hover:underline">
                    {p.address}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    {propertyLine(p)}
                    {parseJsonList(p.stages).map((st) => (
                      <span key={st} className={`chip text-[10px] ${aqStageTone(st)}`}>
                        {st}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </AssocCard>
        </>
      }
    />
  );
}
