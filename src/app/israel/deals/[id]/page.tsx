import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate } from "@/lib/format";
import { IL_DEAL_STAGES, apartmentLine, ilFullName, ilStageTone, nis } from "@/lib/israel";
import { addIlNote, deleteIlDeal, moveIlDeal, updateIlDeal } from "../../actions";
import { IlDealForm } from "../deal-form";
import { dealOptions } from "../options";
import { SelectField } from "@/components/select-field";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.ilDeal.findUnique({ where: { id }, select: { name: true } });
  return { title: d?.name ?? "Deal" };
}

/** A deal ticket: the deal on the left, the running notes in the middle, the apartment and the people on the right. */
export default async function IlDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d, opts] = await Promise.all([
    prisma.ilDeal.findUnique({ where: { id }, include: { apartment: { include: { developer: { select: { id: true, name: true } } } }, buyer: { include: { company: { select: { name: true } } } }, agent: { include: { company: { select: { name: true } } } }, notes: { orderBy: { createdAt: "desc" } } } }),
    dealOptions(),
  ]);
  if (!d) notFound();
  const move = async (fd: FormData) => {
    "use server";
    await moveIlDeal(id, String(fd.get("stage") ?? ""));
  };
  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/israel/deals"
            backLabel="Deals"
            initial={(d.buyer?.firstName?.[0] ?? d.name[0] ?? "D").toUpperCase()}
            title={d.name}
            subtitle={d.apartment ? apartmentLine(d.apartment) : undefined}
            lines={[
              <form key="stage" action={move} className="flex items-center gap-2">
                <SelectField name="stage" defaultValue={d.stage} className={`input w-auto border py-1 text-xs ${ilStageTone(d.stage)}`}>
                  {IL_DEAL_STAGES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </SelectField>
                <button type="submit" className="btn-soft px-2 py-1 text-xs">
                  Move
                </button>
              </form>,
            ]}
            actions={
              <form action={deleteIlDeal.bind(null, d.id)}>
                <button type="submit" className="btn-ghost text-xs">
                  Delete
                </button>
              </form>
            }
          />
          <AboutCard title="About this deal">
            <IlDealForm d={d} {...opts} action={updateIlDeal.bind(null, d.id)} autosave />
          </AboutCard>
        </>
      }
      center={
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notes and history</h2>
            <span className="text-xs text-muted">{d.notes.length}</span>
          </div>
          <form action={addIlNote.bind(null, { dealId: d.id })} className="flex gap-2 border-b border-line p-3">
            <input name="body" placeholder="Log a call, a viewing, an offer…" className="input" />
            <button className="btn-secondary" type="submit">
              Add
            </button>
          </form>
          <ul className="divide-y divide-line">
            {d.notes.map((nt) => (
              <li key={nt.id} className="px-4 py-3 text-sm">
                <div className="text-xs text-muted">{fmtDate(nt.createdAt)}</div>
                <div className="whitespace-pre-wrap">{nt.body}</div>
              </li>
            ))}
            {d.notes.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Created {fmtDate(d.createdAt)}.</li>}
          </ul>
        </div>
      }
      right={
        <>
          <AssocCard title="Apartment" count={d.apartment ? 1 : 0} empty="Pick the apartment in the form on the left.">
            {d.apartment && (
              <div className="p-4 text-sm">
                <Link href={`/israel/apartments/${d.apartment.id}`} className="font-semibold hover:underline">
                  {d.apartment.name}
                </Link>
                <div className="text-xs text-muted">{apartmentLine(d.apartment)}</div>
                <div className="mt-1 text-xs">
                  {d.apartment.priceNis ? `Asking ${nis(d.apartment.priceNis)}` : ""}
                  {d.apartment.developer ? ` · ${d.apartment.developer.name}` : ""}
                </div>
              </div>
            )}
          </AssocCard>
          <AssocCard title="Buyer" count={d.buyer ? 1 : 0} empty="Pick the buyer in the form on the left.">
            {d.buyer && (
              <div className="p-4 text-sm">
                <Link href={`/israel/contacts/${d.buyer.id}`} className="font-semibold hover:underline">
                  {ilFullName(d.buyer)}
                </Link>
                <div className="truncate text-xs text-muted">{[d.buyer.phone, d.buyer.email].filter(Boolean).join(" · ")}</div>
                {(d.buyer.budgetMaxNis || d.buyer.wantsCities) && <div className="mt-1 text-xs text-muted">{[d.buyer.budgetMaxNis ? `Budget up to ${nis(d.buyer.budgetMaxNis)}` : null, d.buyer.wantsCities, d.buyer.wantsRooms ? `${d.buyer.wantsRooms} rooms` : null].filter(Boolean).join(" · ")}</div>}
              </div>
            )}
          </AssocCard>
          <AssocCard title="Sales agent" count={d.agent ? 1 : 0} empty="Pick the agent in the form on the left.">
            {d.agent && (
              <div className="p-4 text-sm">
                <Link href={`/israel/contacts/${d.agent.id}`} className="font-semibold hover:underline">
                  {ilFullName(d.agent)}
                </Link>
                <div className="truncate text-xs text-muted">{[d.agent.company?.name, d.agent.phone, d.agent.email].filter(Boolean).join(" · ")}</div>
              </div>
            )}
          </AssocCard>
        </>
      }
    />
  );
}
