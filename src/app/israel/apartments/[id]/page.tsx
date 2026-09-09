import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IL_STAGES, apartmentLine, nis, parseJsonList, pricePerSqm, sqm, stageToneIl } from "@/lib/israel";
import { addIlNote, deleteApartment, setApartmentStage, updateApartment } from "../../actions";
import { ApartmentForm } from "../apartment-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prisma.ilApartment.findUnique({ where: { id }, select: { name: true } });
  return { title: a?.name ?? "Apartment" };
}

/** The apartment ticket: specs on the left, notes in the middle, the people around it on the right. */
export default async function ApartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, developers, people] = await Promise.all([
    prisma.ilApartment.findUnique({ where: { id }, include: { developer: true, agent: { include: { company: true } }, seller: { include: { company: true } }, notes: { orderBy: { createdAt: "desc" } } } }),
    prisma.ilCompany.findMany({ where: { kind: "Developer" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.ilContact.findMany({ orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, roles: true } }),
  ]);
  if (!a) notFound();
  const named = people.map((p) => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "(no name)", roles: p.roles }));
  const ppsm = pricePerSqm(a.priceNis, a.internalSqm);
  const facts: [string, string][] = [
    ["Asking price", nis(a.priceNis)],
    ["Price per m²", ppsm ? `₪${ppsm.toLocaleString("en-US")}` : ""],
    ["Rooms", a.rooms ? String(a.rooms) : ""],
    ["Internal", sqm(a.internalSqm)],
    ["Mirpeset", sqm(a.mirpesetSqm)],
    ["Garden", sqm(a.gardenSqm)],
    ["Floor", a.floor != null ? `${a.floor}${a.totalFloors ? ` of ${a.totalFloors}` : ""}` : ""],
    ["Direction", parseJsonList(a.direction).join(", ")],
    ["Parking", a.parking != null ? String(a.parking) : ""],
    ["Storage / elevator / mamad", [a.storage ? "storage" : null, a.elevator ? "elevator" : null, a.mamad ? "mamad" : null].filter(Boolean).join(", ")],
    ["Built / completion", a.builtYear ? String(a.builtYear) : a.completionDate ?? ""],
    ["Type / condition", [a.apartmentType, a.condition].filter(Boolean).join(" · ")],
  ];
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/apartments"
            backLabel="Apartments"
            initial={(a.city?.[0] ?? a.name[0] ?? "A").toUpperCase()}
            title={a.name}
            subtitle={apartmentLine(a)}
            lines={[
              <form key="stage" action={setApartmentStage.bind(null, a.id)} className="flex items-center gap-2">
                <select name="stage" defaultValue={a.stage} className={`input w-auto py-1 text-xs ${stageToneIl[a.stage] ?? ""}`}>
                  {IL_STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <button type="submit" className="btn-soft px-2 py-1 text-xs">
                  Move
                </button>
              </form>,
            ]}
            actions={
              <>
                <Link href={`/israel/search?city=${encodeURIComponent(a.city ?? "")}&rooms=${a.rooms ?? ""}`} className="btn-secondary">
                  Similar apartments
                </Link>
                <form action={deleteApartment.bind(null, a.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          <div className="card">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">At a glance</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <AboutCard title="Edit the apartment">
            <ApartmentForm a={a} developers={developers} agents={named.filter((p) => p.roles.includes("Agent"))} sellers={named.filter((p) => p.roles.includes("Seller"))} action={updateApartment.bind(null, a.id)} />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notes and history</h2>
            <span className="text-xs text-muted">{a.notes.length}</span>
          </div>
          <form action={addIlNote.bind(null, { apartmentId: a.id })} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a note, a viewing, an offer…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {a.notes.map((nt) => (
              <li key={nt.id} className="px-4 py-3 text-sm">
                <div className="text-xs text-muted">{nt.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                <div className="whitespace-pre-wrap">{nt.body}</div>
              </li>
            ))}
            {a.notes.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet.</li>}
          </ul>
          {a.description && (
            <div className="border-t border-line px-4 py-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Description</div>
              <div className="whitespace-pre-wrap text-ink-soft">{a.description}</div>
            </div>
          )}
        </div>
      }
      right={
        <>
          <AssocCard title="Developer" count={a.developer ? 1 : 0} empty="Pick the developer in the form on the left.">
            {a.developer && (
              <div className="p-4 text-sm">
                <Link href={`/israel/companies/${a.developer.id}`} className="font-semibold hover:underline">
                  {a.developer.name}
                </Link>
                <div className="text-xs text-muted">{[a.developer.kind, a.developer.city].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Agent" count={a.agent ? 1 : 0} empty="No agent linked.">
            {a.agent && (
              <div className="p-4 text-sm">
                <Link href={`/israel/contacts/${a.agent.id}`} className="font-semibold hover:underline">
                  {[a.agent.firstName, a.agent.lastName].filter(Boolean).join(" ")}
                </Link>
                <div className="text-xs text-muted">{[a.agent.company?.name, a.agent.phone, a.agent.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Seller" count={a.seller ? 1 : 0} empty="No seller linked.">
            {a.seller && (
              <div className="p-4 text-sm">
                <Link href={`/israel/contacts/${a.seller.id}`} className="font-semibold hover:underline">
                  {[a.seller.firstName, a.seller.lastName].filter(Boolean).join(" ")}
                </Link>
                <div className="text-xs text-muted">{[a.seller.phone, a.seller.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
        </>
      }
    />
  );
}
