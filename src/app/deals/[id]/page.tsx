import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { stageTone } from "@/lib/taxonomy";
import { PageHeader } from "@/components/ui";
import { DealForm } from "@/components/deal-form";
import { fmtDate, fullName } from "@/lib/format";
import { addDealNote, updateDeal } from "../actions";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, users] = await Promise.all([
    prisma.deal.findUnique({
      where: { id },
      include: { owner: true, sponsorCompany: true, activities: { orderBy: { occurredAt: "desc" }, take: 40, include: { contact: true } } },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!deal) notFound();
  const update = updateDeal.bind(null, deal.id);
  const addNote = addDealNote.bind(null, deal.id);

  return (
    <>
      <PageHeader
        title={deal.propertyName ?? deal.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span className={`chip border ${stageTone(deal.stage)}`}>{deal.stage}</span>
            {deal.sponsorCompany ? (
              <Link href={`/companies/${deal.sponsorCompany.id}`} className="hover:underline">
                {deal.sponsorCompany.name}
              </Link>
            ) : (
              deal.sponsorName && <span>{deal.sponsorName}</span>
            )}
            {deal.owner && <span>· {deal.owner.name}</span>}
            {deal.hubspotId && <span className="text-xs">· HubSpot {deal.hubspotId}</span>}
          </span>
        }
        actions={
          <Link href="/deals" className="btn-secondary">
            Back to board
          </Link>
        }
      />
      <div className="grid grid-cols-3 gap-6 px-8 py-6">
        <section className="card col-span-2 p-5">
          <DealForm deal={deal} users={users} action={update} />
        </section>
        <section className="card self-start">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold">Activity</h2>
          </div>
          <form action={addNote} className="flex gap-2 border-b border-line p-4">
            <input name="body" placeholder="Add a note…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {deal.activities.map((a) => (
              <li key={a.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="font-semibold uppercase tracking-wide">{a.type}</span>
                  <span>{fmtDate(a.occurredAt)}</span>
                </div>
                {a.subject && <div className="mt-0.5 font-medium">{a.subject}</div>}
                {a.body && <div className="mt-0.5 whitespace-pre-wrap">{a.body}</div>}
                {a.contact && <div className="mt-1 text-xs text-muted">{fullName(a.contact)}</div>}
              </li>
            ))}
            {deal.activities.length === 0 && <li className="px-5 py-6 text-sm text-muted">No activity yet. Created {fmtDate(deal.createdAt)}.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
