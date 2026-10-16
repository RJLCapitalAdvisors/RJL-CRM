import Link from "next/link";
import { ZoomBox } from "@/components/zoom-box";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CompanyLogo } from "@/components/company-logo";
import { fmtDate } from "@/lib/format";
import { apartmentMissing, compactMissing, houseMissing, ilFullName, nis, pricePerMeter, projectMissing, coDeveloperNames, ownerLabel } from "@/lib/israel";
import { loadIlRequired } from "@/lib/required-items";
import { FillDrawer } from "./fill-drawer";

export const metadata = { title: "The Que" };
export const dynamic = "force-dynamic";

/**
 * The Que (Sep 22, 2026; reshaped Oct 16, 2026): every deal that has entered RJL Israel and is not yet in the system.
 * One tight row per ticket: the deal as "Project" or "Project - X Room", the needed count right beside it (click: the fill
 * panel), then the facts, the broker of record, the deal owner and the date it came in. Approval happens in the panel,
 * only once nothing required is blank.
 */
export default async function IsraelQueuePage() {
  await loadIlRequired();
  const dev = { developer: { select: { id: true, name: true, domain: true, website: true } } };
  const agent = { agent: { select: { firstName: true, lastName: true, email: true } } };
  const [apts, houses, projects, users] = await Promise.all([
    prisma.ilApartment.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, omit: { floorplan: true }, include: { ...dev, ...agent, project: { select: { name: true } } } }),
    prisma.ilHouse.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, omit: { floorplan: true }, include: { ...dev, ...agent, project: { select: { name: true } } } }),
    prisma.ilProject.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, omit: { brochure: true }, include: { ...dev, ...agent } }),
    prisma.user.findMany({ select: { email: true, name: true } }),
  ]);
  const names = new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u.name]));
  type Row = {
    kind: "apartments" | "houses" | "projects"; id: string; title: string; degem: string | null; developerId?: string | null; developerIds?: string | null;
    developer: { id: string; name: string; domain: string | null; website: string | null } | null; city: string | null; neighborhood: string | null;
    rooms: number | null; internal: number | null; mirpeset: number | null; price: number | null; ppm: number | null; delivery: string | null;
    broker: string | null; owner: string | null; createdAt: Date; missing: string[];
  };
  const roomsWord = (r: number | null) => (r != null ? ` - ${r} Room` : "");
  const degemChip = (d: string | null | undefined) => (d && !/^\s*\d+(\.\d)?\s*rooms?\s*$/i.test(d) ? d : null);
  const rows: Row[] = [
    ...apts.map((a): Row => ({ kind: "apartments", id: a.id, title: `${a.project?.name ?? a.name}${roomsWord(a.rooms)}`, degem: degemChip(a.degem), developerId: a.developerId, developerIds: a.developerIds, developer: a.developer, city: a.city, neighborhood: a.neighborhood, rooms: a.rooms, internal: a.internalSqm, mirpeset: a.mirpesetSqm, price: a.priceNis, ppm: pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm), delivery: a.completionDate, broker: a.agent ? ilFullName(a.agent) : null, owner: ownerLabel(a.ownerEmail, names), createdAt: a.createdAt, missing: apartmentMissing({ ...(a as unknown as Record<string, unknown>), developerName: a.developer?.name ?? null }) })),
    ...houses.map((h): Row => ({ kind: "houses", id: h.id, title: `${h.project?.name ? `${h.project.name} - ` : ""}${h.name}`, degem: null, developerId: h.developerId, developerIds: h.developerIds, developer: h.developer, city: h.city, neighborhood: h.neighborhood, rooms: h.rooms, internal: h.internalSqm, mirpeset: h.mirpesetSqm, price: h.priceNis, ppm: pricePerMeter(h.priceNis, h.internalSqm, h.mirpesetSqm), delivery: h.completionDate, broker: h.agent ? ilFullName(h.agent) : null, owner: ownerLabel(h.ownerEmail, names), createdAt: h.createdAt, missing: houseMissing({ ...(h as unknown as Record<string, unknown>), developerName: h.developer?.name ?? null }) })),
    ...projects.map((p): Row => ({ kind: "projects", id: p.id, title: p.name, degem: null, developerId: p.developerId, developerIds: p.developerIds, developer: p.developer, city: p.city, neighborhood: p.neighborhood, rooms: null, internal: null, mirpeset: null, price: null, ppm: null, delivery: p.completionDate, broker: p.agent ? ilFullName(p.agent) : null, owner: ownerLabel(p.ownerEmail, names), createdAt: p.createdAt, missing: compactMissing(projectMissing(p as unknown as Record<string, unknown>)) })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const label: Record<Row["kind"], string> = { apartments: "Apt", houses: "House", projects: "Project" };
  const devNames = new Map((await prisma.ilCompany.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const dash = <span className="text-muted">—</span>;
  return (
    <>
      <PageHeader title="The Que" subtitle={`${rows.length} deal${rows.length === 1 ? "" : "s"} waiting · everything that came in and is not yet in the system`} />
      <div className="mx-6 mt-2 flex items-center gap-3"><span className="text-xs text-muted">Newest first. Click the needed count to fill a ticket in and approve it; only a complete ticket goes in.</span><div id="zoom-tools" className="ml-auto" /></div>
      <div className="mx-6 mt-2 flex h-[calc(100vh-136px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <ZoomBox id="israel-queue"><table className="table dense w-full min-w-[1180px] text-[12.5px]">
            <thead>
              <tr>
                <th className="w-[52px]">Type</th>
                <th>Deal</th>
                <th className="w-[120px]">Needed</th>
                <th>Developer</th>
                <th>City</th>
                <th>Neighborhood</th>
                <th className="text-right">Rooms</th>
                <th className="text-right">m²</th>
                <th className="text-right">Mirpeset</th>
                <th className="text-right">Asking</th>
                <th className="text-right">₪/m²</th>
                <th>Delivery</th>
                <th>Broker of record</th>
                <th>Deal owner</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td><span className="chip bg-cream text-[10px]">{label[r.kind]}</span></td>
                  <td className="max-w-[280px] whitespace-nowrap">
                    <Link href={`/israel/${r.kind}/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                    {r.degem && <span className="ml-1.5 chip bg-cream text-[10px]">{r.degem}</span>}
                  </td>
                  <td className="whitespace-nowrap"><FillDrawer kind={r.kind} id={r.id} title={r.title} missing={r.missing} /></td>
                  <td className="max-w-[180px]">
                    {r.developer ? (
                      <Link href={`/israel/companies/${r.developer.id}`} className="flex items-center gap-1.5 hover:underline">
                        <CompanyLogo domain={r.developer.domain ?? r.developer.website?.replace(/^https?:\/\//, "").split("/")[0]} name={r.developer.name} size={16} />
                        <span className="truncate">{r.developer.name}{coDeveloperNames(r, devNames).length ? ` + ${coDeveloperNames(r, devNames).join(", ")}` : ""}</span>
                      </Link>
                    ) : dash}
                  </td>
                  <td className="whitespace-nowrap">{r.city || dash}</td>
                  <td className="max-w-[150px] truncate" title={r.neighborhood ?? ""}>{r.neighborhood || dash}</td>
                  <td className="text-right tabular-nums">{r.rooms ?? ""}</td>
                  <td className="text-right tabular-nums">{r.internal ?? ""}</td>
                  <td className="text-right tabular-nums">{r.mirpeset ?? ""}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{nis(r.price)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{nis(r.ppm)}</td>
                  <td className="whitespace-nowrap">{r.delivery || dash}</td>
                  <td className="max-w-[140px] truncate whitespace-nowrap" title={r.broker ?? ""}>{r.broker || dash}</td>
                  <td className="whitespace-nowrap">{r.owner || dash}</td>
                  <td className="whitespace-nowrap text-muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-12 text-center text-muted">
                    Nothing waiting. Apartments, houses and projects that arrive by email or WhatsApp land here until someone approves them into the system.
                  </td>
                </tr>
              )}
            </tbody>
          </table></ZoomBox>
        </div>
      </div>
    </>
  );
}
