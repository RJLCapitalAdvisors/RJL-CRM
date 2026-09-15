import Link from "next/link";
import { PhotosWindow } from "@/components/il-photos";
import { IlSummaryCard } from "@/components/il-summary-card";
import { IlMapCard } from "@/components/il-map-card";
import { apartmentSummary } from "@/lib/israel-summary";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { usdIls } from "@/lib/fx";
import { apartmentMissing, ilFullName, nis, parseJsonList, pricePerMeter, sqm, usdFmt } from "@/lib/israel";
import { addIlNote, approveApartment, deleteApartment, linkApartment, updateApartment } from "../../actions";
import { ApartmentForm } from "../apartment-form";
import { FloorplanWindow } from "./floorplan";
import { IlExtraCard } from "@/components/il-extra-card";
import { loadIlRequired } from "@/lib/required-items";
import { SelectField } from "@/components/select-field";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prisma.ilApartment.findUnique({ where: { id }, select: { name: true } });
  return { title: a?.name ?? "Apartment" };
}

/** The apartment ticket: fields on the left like a deal, the floorplan in the middle, developer and people on the right. */
export default async function ApartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, developers, people, fx, projects] = await Promise.all([
    prisma.ilApartment.findUnique({
      where: { id },
      select: {
        id: true, name: true, extra: true, apartmentType: true, street: true, city: true, neighborhood: true, rooms: true, completionDate: true, floor: true, totalFloors: true, buildingUnits: true, internalSqm: true, mirpesetSqm: true, mirpesetCount: true, mirpasot: true, levels: true, ceilingCms: true, ceilingCm: true, machsanSqm: true, machsanLocation: true,
        parkingSpots: true, direction: true, sellerType: true, renovationYear: true, pendingApproval: true, projectId: true, project: { select: { id: true, name: true, totalUnits: true, stories: true, completionDate: true } }, mirpesetDirection: true, mamad: true, priceNis: true, description: true, floorplanType: true, floorplanName: true, updatedAt: true, developerId: true, agentContactId: true, sellerContactId: true,
        developer: { select: { id: true, name: true, roles: true, city: true, website: true, phone: true } },
        agent: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } },
        seller: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        notes: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.ilCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, roles: true } }),
    prisma.ilContact.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, roles: true, company: { select: { name: true } } } }),
    usdIls(),
    prisma.ilProject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
  ]);
  if (!a) notFound();
  const full = (await prisma.ilApartment.findUnique({ where: { id }, omit: { floorplan: true }, include: { developer: { select: { name: true } }, photos: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } } }))!;
  const summary = apartmentSummary(full as unknown as Record<string, unknown>, full.developer?.name ?? null, [full.floorplanType ? "the floorplan" : "", full.photos.length ? "pictures" : ""].filter(Boolean));
  const hasPlan = Boolean(a.floorplanType);
  const ppm = pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm);
  await loadIlRequired();
  const missing = apartmentMissing(a as unknown as Record<string, unknown>);
  const agents = people.filter((p) => parseJsonList(p.roles).includes("Broker"));
  const sellers = people.filter((p) => parseJsonList(p.roles).includes("Seller"));
  const label = (p: (typeof people)[number]) => `${ilFullName(p)}${p.company ? ` (${p.company.name})` : ""}`;
  const link = linkApartment.bind(null, a.id);

  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/apartments"
            backLabel="Apartments"
            initial={(a.city?.[0] ?? a.name[0] ?? "A").toUpperCase()}
            title={a.name}
            subtitle={[a.street, a.neighborhood, a.city].filter(Boolean).join(", ") || undefined}
            lines={[
              a.priceNis ? (
                <span key="price">
                  {nis(a.priceNis)}
                  {fx ? ` · ${usdFmt(a.priceNis / fx.ilsPerUsd)}` : ""}
                  {ppm ? ` · ${nis(ppm)} per m²` : ""}
                </span>
              ) : null,
              a.internalSqm ? <span key="size">{[sqm(a.internalSqm), a.mirpesetSqm ? `${sqm(a.mirpesetSqm)} mirpeset` : null, a.rooms ? `${a.rooms} rooms` : null].filter(Boolean).join(" · ")}</span> : null,
            ].filter(Boolean)}
            actions={
              <>
                <Link href={`/israel/send/apartments/${a.id}`} className="btn-primary text-xs">
                  Send apartment
                </Link>
                <form action={deleteApartment.bind(null, a.id)}>
                <button type="submit" className="btn-ghost text-xs">
                  Delete
                </button>
                </form>
              </>
            }
          />
          {a.pendingApproval && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold">Waiting for approval</div>
              {missing.length ? <div className="mt-0.5">This ticket came in by email and is not in the Apartments list yet. Still needed: {missing.join(", ")}.</div> : <div className="mt-0.5">The data is complete. Approve it to add it to the Apartments list.</div>}
              {missing.length === 0 && (
                <form action={approveApartment.bind(null, a.id)} className="mt-2">
                  <button type="submit" className="btn-primary px-3 py-1.5 text-xs">
                    Approve
                  </button>
                </form>
              )}
            </div>
          )}
          <IlExtraCard kind="apartments" id={a.id} extra={a.extra} />
          <AboutCard title="About this apartment">
            <ApartmentForm a={a} fx={fx} projects={projects} action={updateApartment.bind(null, a.id)} autosave />
          </AboutCard>
        </>
      }
      center={
        <>
          <div className="grid gap-4 xl:grid-cols-2 xl:[&>*]:h-[68vh]">
            <IlSummaryCard email={summary} sendHref={`/israel/send/apartments/${a.id}`} notes={a.notes} />
            <FloorplanWindow apartmentId={a.id} has={hasPlan} type={a.floorplanType} name={a.floorplanName} version={a.updatedAt.getTime()} compact />
          </div>
          <PhotosWindow kind="apartments" id={a.id} photos={full.photos} />
        </>
      }
      right={
        <>
          <AssocCard title="Project" count={a.project ? 1 : 0} addHref="/israel/projects/new" addLabel="New project" empty="Pick the project in the form on the left.">
            {a.project && (
              <div className="p-4 text-sm">
                <Link href={`/israel/projects/${a.project.id}`} className="font-semibold hover:underline">
                  {a.project.name}
                </Link>
                <div className="text-xs text-muted">{[a.project.totalUnits ? `${a.project.totalUnits} units` : null, a.project.stories ? `${a.project.stories} stories` : null, a.project.completionDate].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Developer" count={a.developer ? 1 : 0} addHref="/israel/companies/new" addLabel="New company" empty="Pick the developer below.">
            {a.developer && (
              <div className="px-4 pt-3 text-sm">
                <Link href={`/israel/companies/${a.developer.id}`} className="font-semibold hover:underline">
                  {a.developer.name}
                </Link>
                <div className="text-xs text-muted">{[...parseJsonList(a.developer.roles), a.developer.city, a.developer.phone].filter(Boolean).join(" · ")}</div>
              </div>
            )}
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="developerId" defaultValue={a.developerId ?? ""} className="input text-xs">
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
          <AssocCard title="Broker" count={a.agent ? 1 : 0} addHref="/israel/contacts/new" addLabel="New contact" empty="Pick the agent below (contacts marked Broker).">
            {a.agent && (
              <div className="px-4 pt-3 text-sm">
                <Link href={`/israel/contacts/${a.agent.id}`} className="font-semibold hover:underline">
                  {ilFullName(a.agent)}
                </Link>
                <div className="truncate text-xs text-muted">{[a.agent.company?.name, a.agent.phone, a.agent.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="agentContactId" defaultValue={a.agentContactId ?? ""} className="input text-xs">
                <option value="">No agent</option>
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
          <AssocCard title="Seller" count={a.seller ? 1 : 0} empty="Pick the seller below (contacts marked Seller).">
            {a.seller && (
              <div className="px-4 pt-3 text-sm">
                <Link href={`/israel/contacts/${a.seller.id}`} className="font-semibold hover:underline">
                  {ilFullName(a.seller)}
                </Link>
                <div className="truncate text-xs text-muted">{[a.seller.phone, a.seller.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
            <form action={link} className="flex gap-2 p-3">
              <SelectField name="sellerContactId" defaultValue={a.sellerContactId ?? ""} className="input text-xs">
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
          <IlMapCard kind="apartments" id={a.id} row={full} />
        </>
      }
    />
  );
}
