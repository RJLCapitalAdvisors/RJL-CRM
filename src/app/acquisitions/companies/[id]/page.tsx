import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleCell } from "@/components/il-role-cell";
import { CompanyLogo } from "@/components/company-logo";
import { AQ_ROLES, aqFullName, aqStageTone, parseJsonList, propertyLine } from "@/lib/acquisitions";
import { addAqNote, deleteAqCompany, setAqCompanyRoles, updateAqCompany } from "../../actions";
import { AqCompanyForm } from "../company-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.aqCompany.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Company" };
}

export default async function AqCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.aqCompany.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
      aqNotes: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { occurredAt: "desc" }, take: 200, include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
      properties: { include: { property: { select: { id: true, address: true, neighborhood: true, city: true, state: true, stages: true } } } },
    },
  });
  if (!c) notFound();
  const site = c.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const noteForm = (
    <form action={addAqNote.bind(null, { companyId: c.id })} className="flex gap-2">
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
            backHref="/acquisitions/companies"
            backLabel="Companies"
            initial={c.name[0]?.toUpperCase() ?? "?"}
            avatar={
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-white">
                <CompanyLogo domain={c.domain ?? (site ? site.split("/")[0] : null)} name={c.name} size={28} />
              </div>
            }
            title={c.name}
            subtitle={[c.city, c.state].filter(Boolean).join(", ") || undefined}
            lines={[
              c.website ? (
                <a key="web" href={c.website} target="_blank">
                  {site}
                </a>
              ) : null,
              c.phone,
            ].filter(Boolean)}
            actions={
              <>
                <IlRoleCell roles={c.roles} options={AQ_ROLES} action={setAqCompanyRoles.bind(null, c.id)} />
                <Link href={`/acquisitions/contacts/new?companyId=${c.id}`} className="btn-secondary">
                  Add contact
                </Link>
                <form action={deleteAqCompany.bind(null, c.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          <AboutCard title="About this company">
            <AqCompanyForm c={c} action={updateAqCompany.bind(null, c.id)} autosave />
          </AboutCard>
        </>
      }
      center={<IlActivityLog activities={c.activities} notes={c.aqNotes} form={noteForm} empty="No emails or notes yet. Emails with people at this company in the Acquisitions mailbox appear here." />}
      right={
        <>
          <AssocCard title="Contacts" count={c.contacts.length} addHref={`/acquisitions/contacts/new?companyId=${c.id}`} addLabel="Add contact" empty="Nobody at this company yet.">
            <ul className="divide-y divide-line text-sm">
              {c.contacts.map((p) => (
                <li key={p.id} className="px-4 py-2">
                  <Link href={`/acquisitions/contacts/${p.id}`} className="font-medium hover:underline">
                    {aqFullName(p)}
                  </Link>
                  <div className="truncate text-xs text-muted">{[p.email, p.phone].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </AssocCard>
          <AssocCard title="Properties" count={c.properties.length} addHref="/acquisitions/properties/new" addLabel="New property" empty="Link this company from a property's page.">
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
