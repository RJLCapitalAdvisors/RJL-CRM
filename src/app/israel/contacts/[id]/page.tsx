import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { apartmentLine, nisShort, parseJsonList, stageToneIl } from "@/lib/israel";
import { addIlNote, updateIlContact } from "../../actions";
import { IlContactForm } from "../contact-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.ilContact.findUnique({ where: { id }, select: { firstName: true, lastName: true, email: true } });
  return { title: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact" : "Contact" };
}

export default async function IlContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, companies] = await Promise.all([
    prisma.ilContact.findUnique({ where: { id }, include: { company: true, ilNotes: { orderBy: { createdAt: "desc" } }, agentOf: { orderBy: { updatedAt: "desc" } }, sellerOf: { orderBy: { updatedAt: "desc" } } } }),
    prisma.ilCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!c) notFound();
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact";
  const apartments = [...c.agentOf.map((a) => ({ ...a, as: "agent" })), ...c.sellerOf.map((a) => ({ ...a, as: "seller" }))];
  const roles = parseJsonList(c.roles);
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader backHref="/israel/contacts" backLabel="Contacts" initial={(name[0] ?? "C").toUpperCase()} title={name} subtitle={[roles.join(", "), c.company?.name].filter(Boolean).join(" · ")} actions={roles.includes("Buyer") ? <Link href={`/israel/search?${new URLSearchParams({ ...(c.budgetMaxNis ? { priceMax: String(c.budgetMaxNis) } : {}), ...(c.wantsRooms?.match(/\d+(\.\d+)?/) ? { rooms: c.wantsRooms.match(/\d+(\.\d+)?/)![0] } : {}) }).toString()}`} className="btn-secondary">Apartments for this buyer</Link> : undefined} />
          <AboutCard title="About">
            <IlContactForm c={c} companies={companies} action={updateIlContact.bind(null, c.id)} />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <span className="text-xs text-muted">{c.ilNotes.length}</span>
          </div>
          <form action={addIlNote.bind(null, { contactId: c.id })} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a call, a viewing, what they said…" className="input" />
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
          <AssocCard title="Company" count={c.company ? 1 : 0} empty="No company linked.">
            {c.company && (
              <div className="p-4 text-sm">
                <Link href={`/israel/companies/${c.company.id}`} className="font-semibold hover:underline">
                  {c.company.name}
                </Link>
                <div className="text-xs text-muted">{[c.company.kind, c.company.city].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Apartments" count={apartments.length} empty="Not linked to an apartment yet (as agent or seller).">
            {apartments.map((a) => (
              <div key={`${a.as}-${a.id}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    {a.as} · {apartmentLine(a)}
                  </div>
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
