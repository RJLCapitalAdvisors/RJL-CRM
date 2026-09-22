import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleCell } from "@/components/il-role-cell";
import { SelectField } from "@/components/select-field";
import { CompanyLogo } from "@/components/company-logo";
import { AqMapCard } from "@/components/aq-map-card";
import { fmtDate } from "@/lib/format";
import { AQ_STAGES, aqFullName, aqStageTone, lines, parseJsonList, propertyLine, usd } from "@/lib/acquisitions";
import { addAqNote, addAqTranscript, deleteAqNote, deleteAqProperty, deleteAqTranscript, linkAqProperty, setAqPropertyStages, updateAqProperty } from "../../actions";
import { AqPropertyForm } from "../property-form";
import { getAqDealStages } from "@/lib/acquisitions-stages";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.aqProperty.findUnique({ where: { id }, select: { address: true } });
  return { title: p?.address ?? "Property" };
}

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

/**
 * A property ticket: the property, owner, physical facts and the call on the left (Jonathan's field list), then
 * the transcripts; emails and notes in the middle; the map, companies and people around it on the right.
 */
export default async function AqPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, companies, people, dealStages] = await Promise.all([
    prisma.aqProperty.findUnique({
      where: { id },
      include: {
        companies: { include: { company: { select: { id: true, name: true, domain: true, website: true, roles: true, phone: true } } } },
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, roles: true, company: { select: { name: true } } } } } },
        aqNotes: { orderBy: { createdAt: "desc" } },
        transcripts: { orderBy: { createdAt: "desc" } },
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
  const reminder = p.followUpAt ?? p.callBackAt;
  const facts = [p.assetType, p.squareFeet ? `${p.squareFeet.toLocaleString()} SF` : null, p.acreage ? `${p.acreage} ac` : null, p.yearBuilt ? `built ${p.yearBuilt}` : null, p.lastSalePrice != null ? `last sold ${usd(p.lastSalePrice)}${p.lastSaleDate ? ` ${fmtDate(p.lastSaleDate)}` : ""}` : null].filter(Boolean).join(" · ");
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/acquisitions/properties"
            backLabel="Properties"
            initial={(p.city?.[0] ?? p.address[0] ?? "P").toUpperCase()}
            title={p.address}
            subtitle={[p.businessName, propertyLine(p)].filter(Boolean).join(" · ") || undefined}
            lines={[
              facts ? <span key="f">{facts}</span> : null,
              p.operatorName || p.operatorEntity ? (
                <span key="op">
                  Operator: {[p.operatorName, p.operatorEntity ?? p.businessName].filter(Boolean).join(", ")}
                  {p.operatorPhone && (
                    <>
                      {" · "}
                      <a href={tel(p.operatorPhone)} className="tabular-nums hover:underline">
                        {p.operatorPhone}
                      </a>
                    </>
                  )}
                </span>
              ) : null,
              p.ownerName || p.ownerEntity ? (
                <span key="o">
                  Owner: {[p.ownerName, p.ownerEntity].filter(Boolean).join(", ")}
                  {p.primaryPhone && (
                    <>
                      {" · "}
                      <a href={tel(p.primaryPhone)} className="tabular-nums hover:underline">
                        {p.primaryPhone}
                      </a>
                    </>
                  )}
                </span>
              ) : null,
            ].filter(Boolean)}
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
          {stages.includes("Callback") && reminder && (
            <div className={`rounded-md border px-4 py-2 text-sm ${p.callBackDismissedAt ? "border-line bg-cream-50 text-muted" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              Call back {fmtDate(reminder)}
              {p.callBackDismissedAt ? " · dismissed from the dashboard" : " · on the dashboard's Call Me Back window from that day"}
            </div>
          )}
          <AboutCard title="About this property">
            <AqPropertyForm p={p} dealStages={dealStages} action={updateAqProperty.bind(null, p.id)} autosave />
          </AboutCard>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Call Notes (most recent)</div>
              <span className="text-xs text-muted">{p.aqNotes.length}</span>
            </div>
            <form action={addAqNote.bind(null, { propertyId: p.id })} className="space-y-2 border-b border-line p-4">
              <textarea name="body" rows={3} placeholder="What was said, what they want, next step. It goes to the top." className="input w-full resize-y text-sm" />
              <div className="flex justify-end">
                <button type="submit" className="btn-secondary px-3 py-1 text-xs">
                  Add note
                </button>
              </div>
            </form>
            {p.aqNotes.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No call notes yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {p.aqNotes.map((n, i) => (
                  <li key={n.id} className={`px-4 py-3 text-sm ${i === 0 ? "" : "text-ink-soft"}`}>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>
                        {i === 0 ? "Most recent · " : ""}
                        {n.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                      <form action={deleteAqNote.bind(null, p.id, n.id)}>
                        <button type="submit" className="hover:text-red-700" title="Remove this note">
                          Remove
                        </button>
                      </form>
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {lines(n.body).map((l, li) => (
                        <li key={li}>{l}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Transcript (most recent)</div>
              <span className="text-xs text-muted">{p.transcripts.length}</span>
            </div>
            <form action={addAqTranscript.bind(null, p.id)} className="space-y-2 border-b border-line p-4">
              <textarea name="body" rows={4} placeholder="Paste the call transcript here. It goes to the top." className="input w-full resize-y text-sm" />
              <div className="flex justify-end">
                <button type="submit" className="btn-secondary px-3 py-1 text-xs">
                  Add transcript
                </button>
              </div>
            </form>
            {p.transcripts.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No transcripts yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {p.transcripts.map((t, i) => (
                  <li key={t.id} className={`px-4 py-3 text-sm ${i === 0 ? "" : "text-ink-soft"}`}>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>
                        {i === 0 ? "Most recent · " : ""}
                        {t.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                      <form action={deleteAqTranscript.bind(null, p.id, t.id)}>
                        <button type="submit" className="hover:text-red-700" title="Remove this transcript">
                          Remove
                        </button>
                      </form>
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {lines(t.body).map((l, li) => (
                        <li key={li}>{l}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      }
      center={<IlActivityLog activities={p.activities} notes={[]} form={null} empty="No emails yet. Emails with the people linked to this property land here; call notes and transcripts are on the left." />}
      right={
        <>
          <AqMapCard id={p.id} row={p} />
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
          <AssocCard title="Contacts" count={p.contacts.length} addHref="/acquisitions/contacts/new" addLabel="New contact" empty="People in the CRM tied to this address. The owner's own numbers live on the left.">
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
            Call results:{" "}
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
