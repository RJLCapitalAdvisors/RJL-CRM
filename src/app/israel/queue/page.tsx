import Link from "next/link";
import { ZoomBox } from "@/components/zoom-box";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CompanyLogo } from "@/components/company-logo";
import { fmtDate } from "@/lib/format";
import { apartmentMissing, houseMissing, ilFullName, nis, pricePerMeter, projectMissing } from "@/lib/israel";
import { loadIlRequired } from "@/lib/required-items";
import { QueueApprove } from "./approve-button";

export const metadata = { title: "The Que" };
export const dynamic = "force-dynamic";

/**
 * The Que (Sep 22, 2026): every deal that has entered RJL Israel and is not yet in the system, houses, apartments and
 * projects together, in the same table shape as the lists. Approve on a row sends it in; with data still missing
 * the approval goes to Jonathan's dashboard first (his own click admits it at once).
 */
export default async function IsraelQueuePage() {
  await loadIlRequired();
  const dev = { developer: { select: { id: true, name: true, domain: true, website: true } } };
  const agent = { agent: { select: { firstName: true, lastName: true, email: true } } };
  const [apts, houses, projects] = await Promise.all([
    prisma.ilApartment.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, include: { ...dev, ...agent, project: { select: { name: true } } } }),
    prisma.ilHouse.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, include: { ...dev, ...agent } }),
    prisma.ilProject.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, include: { ...dev, ...agent } }),
  ]);
  type Row = { kind: "apartments" | "houses" | "projects"; id: string; name: string; developer: { id: string; name: string; domain: string | null; website: string | null } | null; city: string | null; neighborhood: string | null; street: string | null; rooms: number | null; internal: number | null; mirpeset: number | null; floor: string | null; price: number | null; ppm: number | null; delivery: string | null; createdAt: Date; from: string | null; source: string | null; missing: string[]; requestedBy: string | null; requestedAt: Date | null };
  const rows: Row[] = [
    ...apts.map((a): Row => ({ kind: "apartments", id: a.id, name: a.name, developer: a.developer, city: a.city, neighborhood: a.neighborhood, street: a.street, rooms: a.rooms, internal: a.internalSqm, mirpeset: a.mirpesetSqm, floor: a.floor != null ? `${a.floor}${a.totalFloors ? ` / ${a.totalFloors}` : ""}` : null, price: a.priceNis, ppm: pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm), delivery: a.completionDate, createdAt: a.createdAt, from: a.agent ? ilFullName(a.agent) : null, source: a.source, missing: apartmentMissing(a as unknown as Record<string, unknown>), requestedBy: a.approvalRequestedBy, requestedAt: a.approvalRequestedAt })),
    ...houses.map((h): Row => ({ kind: "houses", id: h.id, name: h.name, developer: h.developer, city: h.city, neighborhood: h.neighborhood, street: h.street, rooms: h.rooms, internal: h.internalSqm, mirpeset: h.mirpesetSqm, floor: null, price: h.priceNis, ppm: pricePerMeter(h.priceNis, h.internalSqm, h.mirpesetSqm), delivery: null, createdAt: h.createdAt, from: h.agent ? ilFullName(h.agent) : null, source: h.source, missing: houseMissing(h as unknown as Record<string, unknown>), requestedBy: h.approvalRequestedBy, requestedAt: h.approvalRequestedAt })),
    ...projects.map((p): Row => ({ kind: "projects", id: p.id, name: p.name, developer: p.developer, city: p.city, neighborhood: p.neighborhood, street: p.street, rooms: null, internal: null, mirpeset: null, floor: p.stories ? `${p.stories} stories` : null, price: null, ppm: null, delivery: p.completionDate, createdAt: p.createdAt, from: p.agent ? ilFullName(p.agent) : null, source: null, missing: projectMissing(p as unknown as Record<string, unknown>), requestedBy: p.approvalRequestedBy, requestedAt: p.approvalRequestedAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const label: Record<Row["kind"], string> = { apartments: "Apartment", houses: "House", projects: "Project" };
  return (
    <>
      <PageHeader title="The Que" subtitle={`${rows.length} deal${rows.length === 1 ? "" : "s"} waiting · everything that came in and is not yet in the system`} />
      <div className="mx-6 mt-3 flex h-[calc(100vh-100px)] min-h-[400px] flex-col overflow-hidden rounded-lg border border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-auto">
          <ZoomBox id="israel-queue"><table className="table dense w-full min-w-[1300px]">
            <thead>
              <tr>
                <th>Type</th>
                <th>Deal</th>
                <th>Developer</th>
                <th>City</th>
                <th className="text-right">Rooms</th>
                <th className="text-right">Internal m²</th>
                <th className="text-right">Mirpeset m²</th>
                <th>Floor</th>
                <th className="text-right">Asking price</th>
                <th className="text-right">₪ / m²</th>
                <th>Built / delivery</th>
                <th>Received</th>
                <th className="w-[340px]">Still needed</th>
                <th className="w-[150px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td>
                    <span className="chip bg-cream text-[10px]">{label[r.kind]}</span>
                  </td>
                  <td className="max-w-[300px] whitespace-nowrap">
                    <Link href={`/israel/${r.kind}/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.street && !r.name.includes(r.street) && <span className="ml-2 text-xs text-muted">{r.street}</span>}
                  </td>
                  <td className="max-w-[220px]">
                    {r.developer ? (
                      <Link href={`/israel/companies/${r.developer.id}`} className="flex items-center gap-2 hover:underline">
                        <CompanyLogo domain={r.developer.domain ?? r.developer.website?.replace(/^https?:\/\//, "").split("/")[0]} name={r.developer.name} />
                        <span className="truncate">{r.developer.name}</span>
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{[r.neighborhood, r.city].filter(Boolean).join(", ") || <span className="text-muted">—</span>}</td>
                  <td className="text-right tabular-nums">{r.rooms ?? ""}</td>
                  <td className="text-right tabular-nums">{r.internal ?? ""}</td>
                  <td className="text-right tabular-nums">{r.mirpeset ?? ""}</td>
                  <td className="whitespace-nowrap">{r.floor ?? ""}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{nis(r.price)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{nis(r.ppm)}</td>
                  <td className="whitespace-nowrap">{r.delivery ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap text-xs text-muted">
                    {fmtDate(r.createdAt)}
                    {r.from ? ` · ${r.from}` : ""}
                    {r.source ? ` · ${r.source}` : ""}
                  </td>
                  <td className="w-[340px] max-w-[340px] whitespace-normal text-xs leading-5">
                    {r.missing.length === 0 ? (
                      <span className="chip bg-emerald-100 text-[11px] text-emerald-900">Complete</span>
                    ) : (
                      <details className="group">
                        <summary className="cursor-pointer list-none">
                          <span className="chip bg-amber-100 text-[11px] text-amber-900">{r.missing.length} missing</span>
                          <span className="ml-2 text-muted group-open:hidden">{r.missing.slice(0, 3).join(", ")}{r.missing.length > 3 ? ", …" : ""}</span>
                        </summary>
                        <ul className="mt-1 list-disc pl-5 text-ink-soft">
                          {r.missing.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {r.requestedAt && <div className="mt-1 text-muted">Approved by {r.requestedBy} {fmtDate(r.requestedAt)}; waiting on Jonathan</div>}
                  </td>
                  <td className="w-[150px] whitespace-nowrap text-right align-top">{r.requestedAt ? <span className="text-xs text-muted">On the dashboard</span> : <QueueApprove kind={r.kind} id={r.id} missing={r.missing.length} />}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-muted">
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
