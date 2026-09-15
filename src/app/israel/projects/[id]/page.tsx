import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { IlActivityLog } from "@/components/il-activity";
import { IlRoleChips } from "@/components/il-role-cell";
import { usdIls } from "@/lib/fx";
import { apartmentLine, houseLine, nis, nisShort, projectMissing, sqm, usdFmt } from "@/lib/israel";
import { IlExtraCard } from "@/components/il-extra-card";
import { loadIlRequired } from "@/lib/required-items";
import { projectRanges, type Range } from "@/lib/project-ranges";
import { addIlNote, deleteIlProject, updateIlProject } from "../../actions";
import { IlProjectForm } from "../project-form";
import { FloorplanWindow } from "../../apartments/[id]/floorplan";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.ilProject.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? "Project" };
}

/**
 * A project ticket. Left: the project's own facts, then "From the units": ranges and counts that fill themselves
 * from the apartments and houses filed under the project. Middle: every email about the project (with its
 * developer, with the brokers and sellers of its units, or naming the project), plus notes. Right: developer,
 * the brochure, the units.
 */
export default async function IlProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, developers, fx] = await Promise.all([
    prisma.ilProject.findUnique({
      where: { id },
      include: {
        developer: true,
        apartments: { orderBy: [{ floor: "desc" }, { name: "asc" }], select: { id: true, name: true, street: true, rooms: true, internalSqm: true, mirpesetSqm: true, mirpasot: true, priceNis: true, floor: true, ceilingCm: true, ceilingCms: true, parkingSpots: true, sellerType: true, completionDate: true, mamad: true, direction: true, levels: true, machsanSqm: true, pendingApproval: true, agentContactId: true, sellerContactId: true, city: true, neighborhood: true } },
        houses: { orderBy: { name: "asc" }, select: { id: true, name: true, street: true, rooms: true, internalSqm: true, mirpesetSqm: true, mirpasot: true, priceNis: true, floors: true, ceilingCms: true, parkingSpots: true, sellerType: true, completionDate: true, mamad: true, migrashSqm: true, pendingApproval: true, agentContactId: true, sellerContactId: true, city: true, neighborhood: true } },
        notes: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.ilCompany.findMany({ where: { roles: { contains: "Sponsor" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    usdIls(),
  ]);
  if (!p) notFound();
  await loadIlRequired();
  const missing = projectMissing(p as unknown as Record<string, unknown>);

  // emails about the project: with its developer's people, with the brokers and sellers of its units, or naming the project
  const people = [...p.apartments, ...p.houses].flatMap((u) => [u.agentContactId, u.sellerContactId]).filter((x): x is string => Boolean(x));
  const activities = await prisma.ilActivity.findMany({
    where: { OR: [{ contactId: { in: people } }, ...(p.developerId ? [{ companyId: p.developerId }] : []), { subject: { contains: p.name, mode: "insensitive" } }] },
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: { contact: { select: { id: true, firstName: true, lastName: true } } },
  });

  const r = projectRanges([...p.apartments.map((a) => ({ ...a, kind: "apartment" as const })), ...p.houses.map((h) => ({ ...h, kind: "house" as const }))]);
  const usd = (v: number) => (fx ? usdFmt(v / fx.ilsPerUsd) : null);
  const span = (x: Range | null, fmt: (n: number) => string) => (x ? (x.min === x.max ? fmt(x.min) : `${fmt(x.min)} to ${fmt(x.max)}`) : null);
  const boxes: { label: string; value: string | null; sub?: string | null }[] = [
    { label: "Units in the CRM", value: r.units ? `${r.units}${p.totalUnits ? ` of ${p.totalUnits}` : ""}` : null, sub: [r.apartments ? `${r.apartments} apartments` : null, r.houses ? `${r.houses} houses` : null, r.pending ? `${r.pending} waiting for approval` : null].filter(Boolean).join(" · ") || null },
    { label: "Rooms", value: span(r.rooms, (n) => String(n)) },
    { label: "Internal size", value: span(r.internalSqm, (n) => sqm(n)) },
    { label: "Mirpeset", value: span(r.mirpesetSqm, (n) => sqm(n)) },
    { label: "Asking price", value: span(r.priceNis, (n) => nisShort(n)), sub: r.priceNis ? [usd(r.priceNis.min), usd(r.priceNis.max)].filter(Boolean).join(" to ") : null },
    { label: "Price per meter", value: span(r.ppm, (n) => nis(n)) },
    { label: "Floors", value: span(r.floor, (n) => (n === 0 ? "Ground" : String(n))), sub: r.duplexes ? `${r.duplexes} duplex or triplex` : null },
    { label: "Ceiling height", value: span(r.ceilingCm, (n) => `${n} cm`) },
    { label: "Built or delivery", value: r.deliveries.length ? r.deliveries.map(([d]) => d).join(", ") : null },
    { label: "Parking", value: r.parking.length ? r.parking.map(([k, n]) => `${k} (${n})`).join(", ") : null },
    { label: "Seller type", value: r.sellerTypes.length ? r.sellerTypes.map(([k, n]) => `${k.replace("Yad Rishona (developer)", "Yad rishona")} (${n})`).join(", ") : null },
    { label: "Directions", value: r.directions.length ? r.directions.map(([k, n]) => `${k} (${n})`).join(", ") : null },
    { label: "Mamad", value: r.units ? `${r.mamad} of ${r.units}` : null },
    { label: "Sukka", value: r.sukkaYes || r.sukkaPartial ? [r.sukkaYes ? `${r.sukkaYes} yes` : null, r.sukkaPartial ? `${r.sukkaPartial} partial` : null].filter(Boolean).join(", ") : null },
    { label: "Machsan", value: r.units ? `${r.withMachsan} of ${r.units}` : null },
  ];

  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/projects"
            backLabel="Projects"
            initial={(p.city?.[0] ?? p.name[0] ?? "P").toUpperCase()}
            title={p.name}
            subtitle={[p.street, p.neighborhood, p.city].filter(Boolean).join(", ") || undefined}
            lines={[<span key="b">{[p.totalUnits ? `${p.totalUnits} units` : null, p.stories ? `${p.stories} stories` : null, p.parkingSpaces ? `${p.parkingSpaces} parking spaces` : null, p.completionDate].filter(Boolean).join(" · ")}</span>]}
            actions={
              <>
                <Link href={`/israel/apartments/new?projectId=${p.id}`} className="btn-secondary">
                  Add apartment
                </Link>
                <Link href={`/israel/houses/new?projectId=${p.id}`} className="btn-secondary">
                  Add house
                </Link>
                <form action={deleteIlProject.bind(null, p.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          {missing.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">Still needed on this project: {missing.join(", ")}.</div>}
          <IlExtraCard kind="projects" id={p.id} extra={p.extra} />
          <AboutCard title="About this project">
            <IlProjectForm p={p} developers={developers} action={updateIlProject.bind(null, p.id)} autosave />
          </AboutCard>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">From the units</div>
              <span className="text-xs text-muted">fills itself from the apartments and houses</span>
            </div>
            {r.units === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">Ranges appear here as apartments and houses are filed under this project.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {boxes.map((b) => (
                  <div key={b.label} className={`rounded-md border border-line px-3 py-2 ${b.value ? "bg-white" : "bg-cream/40"}`}>
                    <div className="text-[10px] uppercase tracking-wide text-muted">{b.label}</div>
                    <div className={`text-sm font-medium tabular-nums ${b.value ? "" : "text-muted"}`}>{b.value ?? "—"}</div>
                    {b.sub && <div className="text-[11px] text-muted">{b.sub}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      }
      center={
        <IlActivityLog
          activities={activities}
          notes={p.notes}
          empty={`No activity yet. Emails with ${p.developer?.name ?? "the developer"}, with the brokers and sellers of units here, or naming "${p.name}" will appear here.`}
          form={
            <form action={addIlNote.bind(null, { projectId: p.id })} className="flex gap-2 border-b border-line p-3">
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
          <AssocCard title="Developer" count={p.developer ? 1 : 0} empty="Pick the developer in the form on the left.">
            {p.developer && (
              <div className="p-4 text-sm">
                <Link href={`/israel/companies/${p.developer.id}`} className="font-semibold hover:underline">
                  {p.developer.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <IlRoleChips roles={p.developer.roles} focus={p.developer.sponsorFocus} size="text-[10px]" />
                  {[p.developer.city, p.developer.phone].filter(Boolean).join(" · ")}
                </div>
              </div>
            )}
          </AssocCard>
          <FloorplanWindow apartmentId={p.id} endpoint={`/api/israel/projects/${p.id}/brochure`} title="Brochure" compact has={Boolean(p.brochureType)} type={p.brochureType} name={p.brochureName} version={p.updatedAt.getTime()} />
          <AssocCard title="Apartments in this project" count={p.apartments.length} addHref={`/israel/apartments/new?projectId=${p.id}`} empty="No apartments listed in this project yet.">
            {p.apartments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="truncate hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    {apartmentLine({ ...a, city: null, neighborhood: null })}
                    {a.pendingApproval ? " · waiting for approval" : ""}
                  </div>
                </div>
                {a.priceNis && <span className="shrink-0 text-xs tabular-nums">{nis(a.priceNis)}</span>}
              </div>
            ))}
          </AssocCard>
          <AssocCard title="Houses in this project" count={p.houses.length} addHref={`/israel/houses/new?projectId=${p.id}`} empty="No houses listed in this project.">
            {p.houses.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/houses/${h.id}`} className="truncate hover:underline">
                    {h.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    {houseLine({ ...h, city: null, neighborhood: null })}
                    {h.pendingApproval ? " · waiting for approval" : ""}
                  </div>
                </div>
                {h.priceNis && <span className="shrink-0 text-xs tabular-nums">{nis(h.priceNis)}</span>}
              </div>
            ))}
          </AssocCard>
        </>
      }
    />
  );
}
