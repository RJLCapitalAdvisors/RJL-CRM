import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleCell } from "@/components/il-role-cell";
import { SelectField } from "@/components/select-field";
import { CompanyLogo } from "@/components/company-logo";
import { fmtDate } from "@/lib/format";
import { AQ_STAGES, aqFullName, aqStageTone, parseJsonList, propertyLine, usd } from "@/lib/acquisitions";
import { addAqNote, deleteAqProperty, linkAqProperty, setAqPropertyStages, updateAqProperty } from "../../actions";
import { AqPropertyForm } from "../property-form";
import { getAqDealStages } from "@/lib/acquisitions-stages";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.aqProperty.findUnique({ where: { id }, select: { address: true } });
  return { title: p?.address ?? "Property" };
}

/** A property ticket: stage tokens and the facts on the left, emails and notes in the middle, the companies and people around it on the right. */
export default async function AqPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, companies, people, dealStages] = await Promise.all([
    prisma.aqProperty.findUnique({
      where: { id },
      include: {
        companies: { include: { company: { select: { id: true, name: true, domain: true, website: true, roles: true, phone: true } } } },
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, roles: true, company: { select: { name: true } } } } } },
        aqNotes: { orderBy: { createdAt: "desc" } },
        activities: { orderBy: { occurredAt: "desc" }, take: 200, include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
      },
    }),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.aqContact.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } } }),
    getAqDealStages(),
  ]);
  if (!p) notFound();
  const stages = parseJsonList(p.stages);
  const link = linkAqProperty.bind(null, p.id);
  const noteForm = (
    <form action={addAqNote.bind(null, { propertyId: p.id })} className="flex gap-2">
      <input name="body" placeholder="Add a note (what was said on the call, what they want, next step)" className="input flex-1 py-1 text-sm" />
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
            backHref="/acquisitions/properties"
            backLabel="Properties"
            initial={(p.city?.[0] ?? p.address[0] ?? "P").toUpperCase()}
            title={p.address}
            subtitle={propertyLine(p) || undefined}
            lines={[<span key="f">{[p.assetType, p.units ? `${p.units} units` : null, p.squareFeet ? `${p.squareFeet.toLocaleString()} SF` : null, p.askingPrice != null ? `asking ${usd(p.askingPrice)}` : null].filter(Boolean).join(" · ")}</span>]}
            actions={
              <>
                <IlRoleCell roles={p.stages} options={AQ_STAGES} action={setAqPropertyStages.bind(null, p.id)} />
                {stages.includes("Deal") && (
                  <Link href={`/acquisitions/pipeline#${encodeURIComponent(p.dealStage ?? dealStages[0])}`} className="btn-secondary">
                    Pipeline · {p.dealStage ?? dealStages[0]}
                  </Link>
                )}
                <form action={deleteAqProperty.bind(null, p.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          {stages.includes("Call me back") && p.callBackAt && (
            <div className={`rounded-md border px-4 py-2 text-sm ${p.callBackDismissedAt ? "border-line bg-cream-50 text-muted" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              Call back {fmtDate(p.callBackAt)}
              {p.callBackDismissedAt ? " · dismissed from the dashboard" : " · on the dashboard's Call Me Back window that day"}
            </div>
          )}
          <AboutCard title="About this property">
            <AqPropertyForm p={p} dealStages={dealStages} action={updateAqProperty.bind(null, p.id)} autosave />
          </AboutCard>
        </>
      }
      center={<IlActivityLog activities={p.activities} notes={p.aqNotes} form={noteForm} empty="No emails or notes yet. Emails with the people linked here land on the property; notes go in above." />}
      right={
        <>
          <AssocCard title="Companies" count={p.companies.length} addHref="/acquisitions/companies/new" addLabel="New company" empty="The seller, operator or buyer behind this address. Pick below.">
            <ul className="divide-y divide-line text-sm">
              {p.companies.map(({ company: c }) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={`/acquisitions/companies/${c.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                    <CompanyLogo domain={c.domain ?? c.website?.replace(/^https?:\/\//, "").split("/")[0]} name={c.name} />
                    <span className="truncate">
                      {c.name}
                      <span className="ml-1 text-xs text-muted">{parseJsonList(c.roles).join(", ")}</span>
                    </span>
                  </Link>
                  <form action={link}>
                    <input type="hidden" name="unlinkCompanyId" value={c.id} />
                    <button type="submit" className="text-xs text-muted hover:text-red-700" title="Unlink">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="companyId" defaultValue="" className="input text-xs">
                <option value="">Link a company…</option>
                {companies.filter((c) => !p.companies.some((x) => x.companyId === c.id)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <button className="btn-secondary px-2 text-xs" type="submit">
                Link
              </button>
            </form>
          </AssocCard>
          <AssocCard title="Contacts" count={p.contacts.length} addHref="/acquisitions/contacts/new" addLabel="New contact" empty="The people to call about this address. Pick below; their numbers show on the Call Me Back window.">
            <ul className="divide-y divide-line text-sm">
              {p.contacts.map(({ contact: c }) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="min-w-0">
                    <Link href={`/acquisitions/contacts/${c.id}`} className="font-medium hover:underline">
                      {aqFullName(c)}
                    </Link>
                    <div className="truncate text-xs text-muted">{[c.company?.name, c.phone, c.email].filter(Boolean).join(" · ")}</div>
                  </div>
                  <form action={link}>
                    <input type="hidden" name="unlinkContactId" value={c.id} />
                    <button type="submit" className="text-xs text-muted hover:text-red-700" title="Unlink">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="contactId" defaultValue="" className="input text-xs">
                <option value="">Link a person…</option>
                {people.filter((c) => !p.contacts.some((x) => x.contactId === c.id)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {aqFullName(c)}
                    {c.company ? ` (${c.company.name})` : ""}
                  </option>
                ))}
              </SelectField>
              <button className="btn-secondary px-2 text-xs" type="submit">
                Link
              </button>
            </form>
          </AssocCard>
          <div className="px-1 text-[11px] text-muted">
            Stage tokens:{" "}
            {AQ_STAGES.map((st) => (
              <span key={st} className={`chip mr-1 text-[10px] ${aqStageTone(st)}`}>
                {st}
              </span>
            ))}
          </div>
        </>
      }
    />
  );
}
