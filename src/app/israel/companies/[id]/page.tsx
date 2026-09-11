import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate } from "@/lib/format";
import { apartmentLine, ilFullName, nis, parseJsonList } from "@/lib/israel";
import { addIlNote, setIlCompanyRoles, updateIlCompany } from "../../actions";
import { CompanyLogo } from "@/components/company-logo";
import { IlRoleCell, IlRoleChips } from "@/components/il-role-cell";
import { IL_COMPANY_ROLES } from "@/lib/israel";
import { IlCompanyForm } from "../company-form";
import { IlActivityLog } from "@/components/il-activity";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilCompany.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Company" };
}

export default async function IlCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilCompany.findUnique({ where: { id }, include: { contacts: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }, apartments: { orderBy: { updatedAt: "desc" } }, ilNotes: { orderBy: { createdAt: "desc" } }, activities: { orderBy: { occurredAt: "desc" }, take: 200, include: { contact: { select: { id: true, firstName: true, lastName: true } } } } } });
  if (!c) notFound();
  const site = c.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/companies"
            backLabel="Companies"
            initial={c.name[0]?.toUpperCase() ?? "?"}
            avatar={
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-white">
                <CompanyLogo domain={c.domain ?? (site ? site.split("/")[0] : null)} name={c.name} size={28} />
              </div>
            }
            title={c.name}
            subtitle={c.city ?? undefined}
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
                <IlRoleCell roles={c.roles} options={IL_COMPANY_ROLES} action={setIlCompanyRoles.bind(null, c.id)} />
                <Link href={`/israel/contacts/new?companyId=${c.id}`} className="btn-secondary">
                  Add contact
                </Link>
              </>
            }
          />
          <details className="card" open>
            <summary className="cursor-pointer border-b border-line px-4 py-3 text-sm font-semibold">About this company</summary>
            <div className="px-4 py-2">
              <IlCompanyForm c={c} action={updateIlCompany.bind(null, c.id)} autosave />
            </div>
          </details>
        </>
      }
      center={
        <IlActivityLog
          activities={c.activities}
          notes={c.ilNotes}
          empty="No activity with this company yet. Emails with its people from the RJL Israel mailboxes will appear here."
          form={
            <form action={addIlNote.bind(null, { companyId: c.id })} className="flex gap-2 border-b border-line p-3">
              <input name="body" placeholder="Log a note…" className="input" />
              <button className="btn-secondary" type="submit">
                Add
              </button>
            </form>
          }
        />
      }
      right={
        <>
          <AssocCard title="Contacts" count={c.contacts.length} addHref={`/israel/contacts/new?companyId=${c.id}`} empty="No contacts linked yet.">
            {c.contacts.map((k) => (
              <div key={k.id} className="px-4 py-2.5 text-sm">
                <Link href={`/israel/contacts/${k.id}`} className="font-medium hover:underline">
                  {ilFullName(k)}
                </Link>
                <div className="truncate text-xs text-muted">{[parseJsonList(k.roles).join(", "), k.phone, k.email].filter(Boolean).join(" · ")}</div>
              </div>
            ))}
          </AssocCard>
          <AssocCard title="Apartments" count={c.apartments.length} addHref="/israel/apartments/new" empty="Apartments this company develops or lists will show here.">
            {c.apartments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="truncate hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{apartmentLine(a)}</div>
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
