import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Item, ItemForm } from "@/app/dash-item";
import { aqFullName, propertyLine } from "@/lib/acquisitions";
import { dismissCallBack } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Acquisitions dashboard: for now only Call Me Back (Jonathan, Sep 18, 2026). Every property marked "Call me
 * back" whose date has arrived, with the people to call and their phone numbers; it stays until dismissed.
 */
export default async function AcquisitionsDashboard() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const callBacks = await prisma.aqProperty.findMany({
    where: { stages: { contains: '"Call me back"' }, callBackAt: { lte: endOfToday }, callBackDismissedAt: null },
    orderBy: { callBackAt: "asc" },
    include: { contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } } } }, companies: { include: { company: { select: { id: true, name: true, phone: true } } } } },
  });
  const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
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
            <div className="px-4 py-10 text-center text-sm text-muted">Nothing to call back today. Mark a property &quot;Call me back&quot; with a date and it shows up here that day, with the numbers to dial, until you dismiss it.</div>
          ) : (
            <ul className="divide-y divide-line">
              {callBacks.map((p) => {
                const people = p.contacts.map((x) => x.contact);
                const overdue = Boolean(p.callBackAt && p.callBackAt.getTime() < startOfToday);
                return (
                  <Item key={p.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/acquisitions/properties/${p.id}`} className="font-medium hover:underline">
                          {p.address}
                        </Link>
                        <div className="text-xs text-muted">{propertyLine(p)}</div>
                        <div className="mt-1 text-xs">
                          {people.length ? (
                            people.map((c) => (
                              <div key={c.id} className="flex flex-wrap items-center gap-2">
                                <Link href={`/acquisitions/contacts/${c.id}`} className="hover:underline">
                                  {aqFullName(c)}
                                </Link>
                                {c.company?.name && <span className="text-muted">{c.company.name}</span>}
                                {c.phone ? (
                                  <a href={tel(c.phone)} className="font-medium tabular-nums text-sky-700 hover:underline">
                                    {c.phone}
                                  </a>
                                ) : (
                                  <span className="text-muted">no phone on file</span>
                                )}
                              </div>
                            ))
                          ) : p.companies.length ? (
                            p.companies.map((x) => (
                              <div key={x.company.id} className="flex flex-wrap items-center gap-2">
                                <Link href={`/acquisitions/companies/${x.company.id}`} className="hover:underline">
                                  {x.company.name}
                                </Link>
                                {x.company.phone ? (
                                  <a href={tel(x.company.phone)} className="font-medium tabular-nums text-sky-700 hover:underline">
                                    {x.company.phone}
                                  </a>
                                ) : (
                                  <span className="text-muted">no phone on file</span>
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="text-muted">Nobody linked to this property yet; open it to add the contact.</span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          Call back {p.callBackAt ? fmtDate(p.callBackAt) : ""}
                          {overdue ? " · overdue" : ""}
                        </div>
                      </div>
                      <ItemForm action={dismissCallBack.bind(null, p.id)} className="btn-grey px-3 py-1.5 text-xs" title="Done, or no longer needed; the property keeps its stage">
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
