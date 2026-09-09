import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { apartmentLine, nisShort, parseJsonList, stageToneIl } from "@/lib/israel";
import { addIlNote, updateIlCompany } from "../../actions";
import { IlCompanyForm } from "../company-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilCompany.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Company" };
}

export default async function IlCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilCompany.findUnique({ where: { id }, include: { contacts: { orderBy: { lastName: "asc" } }, apartments: { orderBy: { updatedAt: "desc" } }, ilNotes: { orderBy: { createdAt: "desc" } } } });
  if (!c) notFound();
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader backHref="/israel/companies" backLabel="Companies" initial={(c.name[0] ?? "C").toUpperCase()} title={c.name} subtitle={[c.kind, c.city].filter(Boolean).join(" · ")} actions={<Link href={`/israel/contacts/new?companyId=${c.id}`} className="btn-secondary">Add contact</Link>} />
          <AboutCard title="About">
            <IlCompanyForm c={c} action={updateIlCompany.bind(null, c.id)} />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <span className="text-xs text-muted">{c.ilNotes.length}</span>
          </div>
          <form action={addIlNote.bind(null, { companyId: c.id })} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a note…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {c.ilNotes.map((nt) => (
              <li key={nt.id} className="px-4 py-3 text-sm">
                <div className="text-xs text-muted">{nt.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                <div className="whitespace-pre-wrap">{nt.body}</div>
              </li>
            ))}
            {c.ilNotes.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet.</li>}
          </ul>
        </div>
      }
      right={
        <>
          <AssocCard title="Contacts" count={c.contacts.length} addHref={`/israel/contacts/new?companyId=${c.id}`} empty="Nobody here yet.">
            {c.contacts.map((p) => (
              <div key={p.id} className="px-4 py-2 text-sm">
                <Link href={`/israel/contacts/${p.id}`} className="hover:underline">
                  {[p.firstName, p.lastName].filter(Boolean).join(" ") || p.email}
                </Link>
                <div className="truncate text-xs text-muted">{[parseJsonList(p.roles).join(", "), p.phone, p.email].filter(Boolean).join(" · ")}</div>
              </div>
            ))}
          </AssocCard>
          <AssocCard title="Apartments" count={c.apartments.length} empty="No apartments from this company yet.">
            {c.apartments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{apartmentLine(a)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.priceNis && <span className="text-xs">{nisShort(a.priceNis)}</span>}
                  <span className={`chip text-[10px] ${stageToneIl[a.stage] ?? ""}`}>{a.stage}</span>
                </div>
              </div>
            ))}
          </AssocCard>
        </>
      }
    />
  );
}
