import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Item, ItemForm } from "@/app/dash-item";
import { aqFullName, lines, propertyLine } from "@/lib/acquisitions";
import { dismissCallBack } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Acquisitions dashboard: for now only Call Me Back (Jonathan, Sep 18, 2026). Every property whose Call Result
 * is Callback and whose follow-up date (the callback target unless typed over) has arrived, with the owner's
 * numbers and the people linked to it; it stays until dismissed.
 */
export default async function AcquisitionsDashboard() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const callBacks = await prisma.aqProperty.findMany({
    where: { stages: { contains: '"Callback"' }, callBackDismissedAt: null, OR: [{ followUpAt: { lte: endOfToday } }, { followUpAt: null, callBackAt: { lte: endOfToday } }] },
    orderBy: [{ followUpAt: "asc" }, { callBackAt: "asc" }],
    include: { contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } } } } },
  });
  const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
  const Phone = ({ n }: { n: string }) => (
    <a href={tel(n)} className="font-medium tabular-nums text-sky-700 hover:underline">
      {n}
    </a>
  );
  return (
    <>
      <PageHeader title="Dashboard" subtitle="RJL Acquisitions" />
      <div className="px-8 py-5">
        <div className="card mx-auto max-w-4xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Call Me Back</div>
            <span className="text-xs text-muted">{callBacks.length}</span>
          </div>
          {callBacks.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">Nothing to call back today. A property whose Call Result is Callback shows up here on its follow-up date, with the numbers to dial, until you dismiss it.</div>
          ) : (
            <ul className="divide-y divide-line">
              {callBacks.map((p) => {
                const due = p.followUpAt ?? p.callBackAt;
                const overdue = Boolean(due && due.getTime() < startOfToday);
                const ownerPhones = [p.primaryPhone, p.secondaryPhone, ...lines(p.otherPhones)].filter((x): x is string => Boolean(x));
                return (
                  <Item key={p.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/acquisitions/properties/${p.id}`} className="font-medium hover:underline">
                          {p.address}
                        </Link>
                        <div className="text-xs text-muted">{[p.businessName, propertyLine(p)].filter(Boolean).join(" · ")}</div>
                        <div className="mt-1 space-y-0.5 text-xs">
                          {(p.ownerName || p.ownerEntity || ownerPhones.length > 0) && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span>{p.ownerName ?? p.ownerEntity}</span>
                              {p.ownerName && p.ownerEntity && <span className="text-muted">{p.ownerEntity}</span>}
                              {ownerPhones.length ? ownerPhones.map((n) => <Phone key={n} n={n} />) : <span className="text-muted">no phone on file</span>}
                            </div>
                          )}
                          {p.contacts.map(({ contact: c }) => (
                            <div key={c.id} className="flex flex-wrap items-center gap-x-2">
                              <Link href={`/acquisitions/contacts/${c.id}`} className="hover:underline">
                                {aqFullName(c)}
                              </Link>
                              {c.company?.name && <span className="text-muted">{c.company.name}</span>}
                              {c.phone ? <Phone n={c.phone} /> : <span className="text-muted">no phone on file</span>}
                            </div>
                          ))}
                          {!p.ownerName && !p.ownerEntity && !ownerPhones.length && p.contacts.length === 0 && <span className="text-muted">No owner or contact on the ticket yet; open it to add one.</span>}
                        </div>
                        {p.callNotes && <div className="mt-1 text-xs text-ink-soft">{p.callNotes}</div>}
                        <div className="mt-1 text-xs text-muted">
                          Call back {due ? fmtDate(due) : ""}
                          {overdue ? " · overdue" : ""}
                        </div>
                      </div>
                      <ItemForm action={dismissCallBack.bind(null, p.id)} className="btn-grey px-3 py-1.5 text-xs" title="Done, or no longer needed; the property keeps its call result">
                        Dismiss
                      </ItemForm>
                    </div>
                  </Item>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
