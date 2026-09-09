import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate } from "@/lib/format";
import { apartmentLine, nis } from "@/lib/israel";
import { addIlNote, deleteIlProject, updateIlProject } from "../../actions";
import { IlProjectForm } from "../project-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.ilProject.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? "Project" };
}

/** A project ticket: the building on the left, notes in the middle, developer and its apartments on the right. */
export default async function IlProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, developers] = await Promise.all([
    prisma.ilProject.findUnique({ where: { id }, include: { developer: true, apartments: { orderBy: [{ floor: "desc" }, { name: "asc" }] }, notes: { orderBy: { createdAt: "desc" } } } }),
    prisma.ilCompany.findMany({ where: { kind: "Developer" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!p) notFound();
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
                <form action={deleteIlProject.bind(null, p.id)}>
                  <button type="submit" className="btn-ghost text-xs">
                    Delete
                  </button>
                </form>
              </>
            }
          />
          <AboutCard title="About this project">
            <IlProjectForm p={p} developers={developers} action={updateIlProject.bind(null, p.id)} autosave />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <span className="text-xs text-muted">{p.notes.length}</span>
          </div>
          <form action={addIlNote.bind(null, { projectId: p.id })} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a note…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {p.notes.map((nt) => (
              <li key={nt.id} className="px-4 py-3 text-sm">
                <div className="text-xs text-muted">{fmtDate(nt.createdAt)}</div>
                <div className="whitespace-pre-wrap">{nt.body}</div>
              </li>
            ))}
            {p.notes.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Created {fmtDate(p.createdAt)}.</li>}
          </ul>
        </div>
      }
      right={
        <>
          <AssocCard title="Developer" count={p.developer ? 1 : 0} empty="Pick the developer in the form on the left.">
            {p.developer && (
              <div className="p-4 text-sm">
                <Link href={`/israel/companies/${p.developer.id}`} className="font-semibold hover:underline">
                  {p.developer.name}
                </Link>
                <div className="text-xs text-muted">{[p.developer.kind, p.developer.city, p.developer.phone].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Apartments in this project" count={p.apartments.length} addHref={`/israel/apartments/new?projectId=${p.id}`} empty="No apartments listed in this project yet.">
            {p.apartments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/israel/apartments/${a.id}`} className="truncate hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate text-xs text-muted">{apartmentLine({ ...a, city: null, neighborhood: null })}</div>
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
