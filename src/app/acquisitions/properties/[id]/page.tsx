import Link from "next/link";
import { JunkTarget } from "@/components/junk-target";
import { PipelineToggle } from "../../pipeline-toggle";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { SelectField } from "@/components/select-field";
import { CompanyLogo } from "@/components/company-logo";
import { AqMapCard } from "@/components/aq-map-card";
import { fmtDate } from "@/lib/format";
import { aqFullName, aqStageTone, parseJsonList, propertyLine, usd, lines } from "@/lib/acquisitions";
import { addAqNote, deleteAqProperty, linkAqProperty, updateAqProperty } from "../../actions";
import { AqPropertyForm } from "../property-form";
import { getAqDealStages } from "@/lib/acquisitions-stages";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.aqProperty.findUnique({ where: { id }, select: { address: true } });
  return { title: p?.address ?? "Property" };
}

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; secondaryPhone: string | null; otherPhones: string | null; roles: string; callResult: string | null; followUpAt: Date | null; callBackAt: Date | null; company: { name: string } | null };

/**
 * A property ticket (Sep 22, 2026): the property, its physical facts and whether it is a deal on the left; emails and
 * notes in the middle; the map, then the Owners and Operators windows (the contact cards linked here, at a glance:
 * open one for the details, calls, notes and transcripts), then Companies on the right.
 */
export default async function AqPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, companies, people, dealStages] = await Promise.all([
    prisma.aqProperty.findUnique({
      where: { id },
      include: {
        companies: { include: { company: { select: { id: true, name: true, domain: true, website: true, roles: true, phone: true } } } },
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, secondaryPhone: true, otherPhones: true, roles: true, callResult: true, followUpAt: true, callBackAt: true, company: { select: { name: true } } } } } },
        aqNotes: { orderBy: { createdAt: "desc" } },
        activities: { orderBy: { occurredAt: "desc" }, take: 200, include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
      },
    }),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.aqContact.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, roles: true, company: { select: { name: true } } } }),
    getAqDealStages(),
  ]);
  if (!p) notFound();
  const stages = parseJsonList(p.stages);
  const link = linkAqProperty.bind(null, p.id);
  const linked = p.contacts.map((x) => x.contact as Person);
  const owners = linked.filter((c) => parseJsonList(c.roles).includes("Owner"));
  const operators = linked.filter((c) => parseJsonList(c.roles).includes("Operator"));
  const others = linked.filter((c) => !owners.includes(c) && !operators.includes(c));
  const facts = [p.assetType, p.squareFeet ? `${p.squareFeet.toLocaleString()} SF` : null, p.acreage ? `${p.acreage} ac` : null, p.yearBuilt ? `built ${p.yearBuilt}` : null, p.lastSalePrice != null ? `last sold ${usd(p.lastSalePrice)}${p.lastSaleDate ? ` ${fmtDate(p.lastSaleDate)}` : ""}` : null].filter(Boolean).join(" · ");
  const noteForm = (
    <form action={addAqNote.bind(null, { propertyId: p.id })} className="flex gap-2">
      <input name="body" placeholder="Add a note about the property" className="input flex-1 py-1 text-sm" />
      <button type="submit" className="btn-secondary px-3 text-xs">
        Note
      </button>
    </form>
  );
  const PeopleWindow = ({ title, role, rows }: { title: string; role: "Owner" | "Operator"; rows: Person[] }) => (
    <AssocCard title={title} count={rows.length} addHref={`/acquisitions/contacts/new?role=${role}&propertyId=${p.id}`} addLabel={`New ${role.toLowerCase()}`} empty={role === "Owner" ? "The owner of the real estate. Add one, or link a contact below." : "The business running here and the person behind it. Add one, or link a contact below."}>
      <ul className="divide-y divide-line text-sm">
        {rows.map((c) => {
          const due = c.followUpAt ?? c.callBackAt;
          return (
            <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <Link href={`/acquisitions/contacts/${c.id}`} className="font-medium hover:underline">
                  {aqFullName(c)}
                </Link>
                <div className="truncate text-xs text-muted">{[c.company?.name, c.email].filter(Boolean).join(" · ")}</div>
                {/* every number on its own, right-click sends one to junk (Shawn, Sep 23, 2026) */}
                <ul className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  {[
                    ...(c.phone ? [{ field: "phone", n: c.phone }] : []),
                    ...(c.secondaryPhone ? [{ field: "secondaryPhone", n: c.secondaryPhone }] : []),
                    ...lines(c.otherPhones).map((n) => ({ field: "otherPhones", n })),
                  ].map((x, i) => (
                    <li key={`${x.field}-${i}`}>
                      <JunkTarget target={{ kind: "phone", contactId: c.id, field: x.field, phone: x.n }}>
                        <a href={tel(x.n)} className="tabular-nums text-sky-700 hover:underline" title="Right-click to send this number to junk">
                          {x.n}
                        </a>
                      </JunkTarget>
                      {x.field === "otherPhones" && <span className="ml-1 text-[10px] text-muted">other</span>}
                    </li>
                  ))}
                </ul>
                {c.callResult && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                    <span className={`chip text-[10px] ${aqStageTone(c.callResult)}`}>{c.callResult}</span>
                    {c.callResult === "Callback" && due && <span className="text-muted">call back {fmtDate(due)}</span>}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {c.phone && (
                  <a href={tel(c.phone)} className="text-xs text-sky-700 hover:underline">
                    Call
                  </a>
                )}
                <form action={link}>
                  <input type="hidden" name="unlinkContactId" value={c.id} />
                  <button type="submit" className="text-xs text-muted hover:text-red-700" title="Unlink">
                    ×
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      <form action={link} className="flex gap-2 p-3">
        <SelectField name="contactId" defaultValue="" className="input text-xs">
          <option value="">Link an existing {role.toLowerCase()}…</option>
          {people
            .filter((c) => parseJsonList(c.roles).includes(role) && !p.contacts.some((x) => x.contactId === c.id))
            .map((c) => (
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
  );
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/acquisitions/properties"
            backLabel="Properties"
            initial={(p.city?.[0] ?? p.address[0] ?? "P").toUpperCase()}
            title={<JunkTarget target={{ kind: "property", propertyId: p.id, label: p.address }}>{p.address}</JunkTarget>}
            subtitle={[p.businessName, propertyLine(p), p.county ? `${p.county} County` : null].filter(Boolean).join(" · ") || undefined}
            lines={[
              facts ? <span key="f">{facts}</span> : null,
              owners.length ? <span key="o">Owner: {owners.map(aqFullName).join(", ")}</span> : null,
              operators.length ? <span key="op">Operator: {operators.map(aqFullName).join(", ")}</span> : null,
            ].filter(Boolean)}
            actions={
              <>
                <PipelineToggle kind="property" id={p.id} at={p.pipelineAt} priority={p.pipelinePriority} compact />
                {stages.includes("Deal") ? (
                  <Link href={`/acquisitions/pipeline#${encodeURIComponent(p.dealStage ?? dealStages[0])}`} className="btn-secondary">
                    Pipeline · {p.dealStage ?? dealStages[0]}
                  </Link>
                ) : (
                  <span className="chip bg-cream text-[11px] text-muted">Not a deal yet</span>
                )}
                <form action={deleteAqProperty.bind(null, p.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          <AboutCard title="About this property">
            <AqPropertyForm p={p} dealStages={dealStages} action={updateAqProperty.bind(null, p.id)} autosave />
          </AboutCard>
        </>
      }
      center={<IlActivityLog activities={p.activities} notes={p.aqNotes} form={noteForm} empty="No emails or notes on the property yet. Calls with the owner and operator are tracked on their contact cards." />}
      right={
        <>
          <AqMapCard id={p.id} row={p} />
          <PeopleWindow title="Owners" role="Owner" rows={owners} />
          <PeopleWindow title="Operators" role="Operator" rows={operators} />
          {others.length > 0 && (
            <AssocCard title="Other contacts" count={others.length} addHref={`/acquisitions/contacts/new?propertyId=${p.id}`} addLabel="New contact" empty="">
              <ul className="divide-y divide-line text-sm">
                {others.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <Link href={`/acquisitions/contacts/${c.id}`} className="font-medium hover:underline">
                        {aqFullName(c)}
                      </Link>
                      <div className="truncate text-xs text-muted">{[parseJsonList(c.roles).join(", "), c.company?.name, c.phone].filter(Boolean).join(" · ")}</div>
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
            </AssocCard>
          )}
          <AssocCard title="Companies" count={p.companies.length} addHref="/acquisitions/companies/new" addLabel="New company" empty="The entities behind this address.">
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
        </>
      }
    />
  );
}
