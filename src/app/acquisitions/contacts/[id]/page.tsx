import Link from "next/link";
import { getAqStages } from "@/lib/acquisitions-stages";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleCell } from "@/components/il-role-cell";
import { CompanyLogo } from "@/components/company-logo";
import { fmtDate } from "@/lib/format";
import { AQ_ROLES, aqFullName, aqStageTone, lines, parseJsonList, propertyLine } from "@/lib/acquisitions";
import { addAqNote, addAqTranscript, deleteAqContact, deleteAqNote, deleteAqTranscript, setAqContactRoles, updateAqContact } from "../../actions";
import { AqContactForm } from "../contact-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.aqContact.findUnique({ where: { id }, select: { firstName: true, lastName: true, email: true } });
  return { title: c ? aqFullName(c) : "Contact" };
}

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

/** A contact card: who they are and how to reach them, operator details when they run a business, the call, then Call Notes and Transcripts newest first; emails in the middle; company and properties on the right. */
export default async function AqContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, companies] = await Promise.all([
    prisma.aqContact.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, domain: true, website: true, roles: true, _count: { select: { contacts: true } } } },
        aqNotes: { orderBy: { createdAt: "desc" } },
        transcripts: { orderBy: { createdAt: "desc" } },
        activities: { orderBy: { occurredAt: "desc" }, take: 200 },
        properties: { include: { property: { select: { id: true, address: true, neighborhood: true, city: true, state: true, businessName: true, stages: true } } } },
      },
    }),
    prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!c) notFound();
  const name = aqFullName(c);
  const roles = parseJsonList(c.roles);
  const reminder = c.followUpAt ?? c.callBackAt;
  const [buyerStages, operatorStages] = await Promise.all([getAqStages("buyers"), getAqStages("operators")]);
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/acquisitions/contacts"
            backLabel="Contacts"
            initial={(c.firstName?.[0] ?? c.lastName?.[0] ?? c.email?.[0] ?? "?").toUpperCase()}
            title={name}
            subtitle={[c.company?.name, roles.includes("Operator") && c.operatorBrandName ? c.operatorBrandName : null].filter(Boolean).join(" · ") || undefined}
            lines={[c.email ? <a key="mail" href={`mailto:${c.email}`}>{c.email}</a> : null, c.phone ? <a key="tel" href={tel(c.phone)}>{c.phone}</a> : null].filter(Boolean)}
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
          {c.callResult && (
            <div className={`flex flex-wrap items-center gap-2 rounded-md border px-4 py-2 text-sm ${c.callResult === "Callback" && reminder && !c.callBackDismissedAt ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-cream-50 text-ink-soft"}`}>
              <span className={`chip text-[11px] ${aqStageTone(c.callResult)}`}>{c.callResult}</span>
              {c.lastCallDate && <span>last call {fmtDate(c.lastCallDate)}</span>}
              {c.callResult === "Callback" && reminder && <span>· call back {fmtDate(reminder)}{c.callBackDismissedAt ? " (dismissed from the dashboard)" : ""}</span>}
            </div>
          )}
          <AboutCard title="About this contact">
            <AqContactForm buyerStages={buyerStages} operatorStages={operatorStages} c={c} companies={companies} action={updateAqContact.bind(null, c.id)} autosave />
          </AboutCard>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Call Notes (most recent)</div>
              <span className="text-xs text-muted">{c.aqNotes.length}</span>
            </div>
            <form action={addAqNote.bind(null, { contactId: c.id })} className="space-y-2 border-b border-line p-4">
              <textarea name="body" rows={3} placeholder="What was said, what they want, next step. It goes to the top." className="input w-full resize-y text-sm" />
              <div className="flex justify-end">
                <button type="submit" className="btn-secondary px-3 py-1 text-xs">
                  Add note
                </button>
              </div>
            </form>
            {c.aqNotes.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No call notes yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {c.aqNotes.map((n, i) => (
                  <li key={n.id} className={`px-4 py-3 text-sm ${i === 0 ? "" : "text-ink-soft"}`}>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>
                        {i === 0 ? "Most recent · " : ""}
                        {n.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                      <form action={deleteAqNote.bind(null, { contactId: c.id }, n.id)}>
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
              <span className="text-xs text-muted">{c.transcripts.length}</span>
            </div>
            <form action={addAqTranscript.bind(null, { contactId: c.id })} className="space-y-2 border-b border-line p-4">
              <textarea name="body" rows={4} placeholder="Paste the call transcript here. It goes to the top." className="input w-full resize-y text-sm" />
              <div className="flex justify-end">
                <button type="submit" className="btn-secondary px-3 py-1 text-xs">
                  Add transcript
                </button>
              </div>
            </form>
            {c.transcripts.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No transcripts yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {c.transcripts.map((t, i) => (
                  <li key={t.id} className={`px-4 py-3 text-sm ${i === 0 ? "" : "text-ink-soft"}`}>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>
                        {i === 0 ? "Most recent · " : ""}
                        {t.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                      <form action={deleteAqTranscript.bind(null, { contactId: c.id }, t.id)}>
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
      center={<IlActivityLog activities={c.activities} notes={[]} form={null} empty="No emails yet. Emails to and from this person in the Acquisitions mailbox appear here; call notes and transcripts are on the left." />}
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
          <AssocCard title="Properties" count={c.properties.length} addHref="/acquisitions/properties/new" addLabel="New property" empty="Link this person from a property's Owners or Operators window.">
            <ul className="divide-y divide-line text-sm">
              {c.properties.map(({ property: p }) => (
                <li key={p.id} className="px-4 py-2">
                  <Link href={`/acquisitions/properties/${p.id}`} className="font-medium hover:underline">
                    {p.address}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    {[p.businessName, propertyLine(p)].filter(Boolean).join(" · ")}
                    {parseJsonList(p.stages).includes("Deal") && <span className={`chip text-[10px] ${aqStageTone("Deal")}`}>Deal</span>}
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
