import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { SelectField } from "@/components/select-field";
import { usdIls } from "@/lib/fx";
import { ilFullName, nis, parseJsonList, pricePerMeter, sqm, usdFmt } from "@/lib/israel";
import { addIlNote, deleteHouse, linkHouse, updateHouse } from "../../actions";
import { HouseForm } from "../house-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await prisma.ilHouse.findUnique({ where: { id }, select: { name: true } });
  return { title: h?.name ?? "House" };
}

/** The house ticket: fields on the left, notes in the middle, developer and people on the right. */
export default async function HousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [h, developers, people, fx] = await Promise.all([
    prisma.ilHouse.findUnique({
      where: { id },
      include: {
        developer: { select: { id: true, name: true, roles: true, city: true, phone: true } },
        agent: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } },
        seller: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        notes: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.ilCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, roles: true } }),
    prisma.ilContact.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, roles: true, company: { select: { name: true } } } }),
    usdIls(),
  ]);
  if (!h) notFound();
  const ppm = pricePerMeter(h.priceNis, h.internalSqm, h.mirpesetSqm);
  const agents = people.filter((p) => parseJsonList(p.roles).includes("Broker"));
  const sellers = people.filter((p) => parseJsonList(p.roles).includes("Seller"));
  const label = (p: (typeof people)[number]) => `${ilFullName(p)}${p.company ? ` (${p.company.name})` : ""}`;
  const link = linkHouse.bind(null, h.id);

  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/houses"
            backLabel="Houses"
            initial={(h.city?.[0] ?? h.name[0] ?? "H").toUpperCase()}
            title={h.name}
            subtitle={[h.street, h.neighborhood, h.city].filter(Boolean).join(", ") || undefined}
            lines={[
              h.priceNis ? (
                <span key="price">
                  {nis(h.priceNis)}
                  {fx ? ` · ${usdFmt(h.priceNis / fx.ilsPerUsd)}` : ""}
                  {ppm ? ` · ${nis(ppm)} per m²` : ""}
                </span>
              ) : null,
              h.internalSqm || h.migrashSqm ? <span key="size">{[h.internalSqm ? sqm(h.internalSqm) : null, h.migrashSqm ? `${sqm(h.migrashSqm)} migrash` : null, h.floors ? `${h.floors} floors` : null, h.rooms ? `${h.rooms} rooms` : null].filter(Boolean).join(" · ")}</span> : null,
            ].filter(Boolean)}
            actions={
              <form action={deleteHouse.bind(null, h.id)}>
                <button type="submit" className="btn-ghost text-xs">
                  Delete
                </button>
              </form>
            }
          />
          <AboutCard title="About this house">
            <HouseForm h={h} fx={fx} action={updateHouse.bind(null, h.id)} autosave />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <span className="text-xs text-muted">{h.notes.length}</span>
          </div>
          <form action={addIlNote.bind(null, { houseId: h.id })} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a note, a viewing, an offer…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {h.notes.map((nt) => (
              <li key={nt.id} className="px-4 py-3 text-sm">
                <div className="text-xs text-muted">{nt.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                <div className="whitespace-pre-wrap">{nt.body}</div>
              </li>
            ))}
            {h.notes.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</li>}
          </ul>
        </div>
      }
      right={
        <>
          <AssocCard title="Developer" count={h.developer ? 1 : 0} addHref="/israel/companies/new" addLabel="New company" empty="Pick the developer below.">
            {h.developer && (
              <div className="px-4 pt-3 text-sm">
                <Link href={`/israel/companies/${h.developer.id}`} className="font-semibold hover:underline">
                  {h.developer.name}
                </Link>
                <div className="text-xs text-muted">{[...parseJsonList(h.developer.roles), h.developer.city, h.developer.phone].filter(Boolean).join(" · ")}</div>
              </div>
            )}
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="developerId" defaultValue={h.developerId ?? ""} className="input text-xs">
                <option value="">No developer</option>
                {developers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {parseJsonList(d.roles).length ? ` (${parseJsonList(d.roles).join(", ")})` : ""}
                  </option>
                ))}
              </SelectField>
              <button className="btn-secondary px-2 text-xs" type="submit">
                Link
              </button>
            </form>
          </AssocCard>
          <AssocCard title="Broker" count={h.agent ? 1 : 0} addHref="/israel/contacts/new" addLabel="New contact" empty="Pick the broker below (contacts marked Broker).">
            {h.agent && (
              <div className="px-4 pt-3 text-sm">
                <Link href={`/israel/contacts/${h.agent.id}`} className="font-semibold hover:underline">
                  {ilFullName(h.agent)}
                </Link>
                <div className="truncate text-xs text-muted">{[h.agent.company?.name, h.agent.phone, h.agent.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="agentContactId" defaultValue={h.agentContactId ?? ""} className="input text-xs">
                <option value="">No broker</option>
                {agents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </SelectField>
              <button className="btn-secondary px-2 text-xs" type="submit">
                Link
              </button>
            </form>
          </AssocCard>
          <AssocCard title="Seller" count={h.seller ? 1 : 0} empty="Pick the seller below (contacts marked Seller).">
            {h.seller && (
              <div className="px-4 pt-3 text-sm">
                <Link href={`/israel/contacts/${h.seller.id}`} className="font-semibold hover:underline">
                  {ilFullName(h.seller)}
                </Link>
                <div className="truncate text-xs text-muted">{[h.seller.phone, h.seller.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="sellerContactId" defaultValue={h.sellerContactId ?? ""} className="input text-xs">
                <option value="">No seller</option>
                {sellers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
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
