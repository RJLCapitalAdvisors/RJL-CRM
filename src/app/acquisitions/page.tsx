import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Item, ItemForm } from "@/app/dash-item";
import { AQ_DEAL_STAGES, aqFullName, parseJsonList, propertyLine } from "@/lib/acquisitions";
import { dismissCallBack } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Acquisitions dashboard. Call Me Back: every property marked "Call me back" whose date has arrived, with the
 * people to call and their phone numbers; it stays until dismissed. Beside it, the latest emails in this side's log
 * and a count of the pipeline by stage.
 */
export default async function AcquisitionsDashboard() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const [callBacks, latest, deals] = await Promise.all([
    prisma.aqProperty.findMany({
      where: { stages: { contains: '"Call me back"' }, callBackAt: { lte: endOfToday }, callBackDismissedAt: null },
      orderBy: { callBackAt: "asc" },
      include: { contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } } } }, companies: { include: { company: { select: { id: true, name: true, phone: true } } } } },
    }),
    prisma.aqActivity.findMany({ orderBy: { occurredAt: "desc" }, take: 12, include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } } } } }),
    prisma.aqProperty.findMany({ where: { stages: { contains: '"Deal"' } }, select: { dealStage: true } }),
  ]);
  const byStage = new Map<string, number>();
  for (const d of deals) byStage.set(d.dealStage ?? AQ_DEAL_STAGES[0], (byStage.get(d.dealStage ?? AQ_DEAL_STAGES[0]) ?? 0) + 1);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="RJL Acquisitions" />
      <div className="grid gap-4 px-8 py-5 xl:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Call Me Back</div>
            <span className="text-xs text-muted">{callBacks.length}</span>
          </div>
          {callBacks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">Nothing to call back today. Mark a property &quot;Call me back&quot; with a date and it shows up here that day, with the numbers to dial, until you dismiss it.</div>
          ) : (
            <ul className="divide-y divide-line">
              {callBacks.map((p) => {
                const people = p.contacts.map((x) => x.contact);
                const overdue = Boolean(p.callBackAt && p.callBackAt.getTime() < new Date().setHours(0, 0, 0, 0));
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
                                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-medium tabular-nums text-sky-700 hover:underline">
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
                                {x.company.phone ? <a href={`tel:${x.company.phone.replace(/[^\d+]/g, "")}`} className="font-medium tabular-nums text-sky-700 hover:underline">{x.company.phone}</a> : <span className="text-muted">no phone on file</span>}
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
        <div className="flex flex-col gap-4">
          <div className="card self-start">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Deal pipeline</div>
              <Link href="/acquisitions/pipeline" className="text-xs text-muted hover:underline">
                Open
              </Link>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3 text-sm">
              {AQ_DEAL_STAGES.map((st) => (
                <Link key={st} href={`/acquisitions/pipeline#${encodeURIComponent(st)}`} className="rounded-md border border-line bg-white px-3 py-1.5 hover:bg-cream">
                  <span className="font-medium">{byStage.get(st) ?? 0}</span> <span className="text-muted">{st}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Latest emails</div>
              <span className="text-xs text-muted">{latest.length}</span>
            </div>
            {latest.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted">Emails from the Acquisitions mailbox land here as contacts and companies are made from them.</div>
            ) : (
              <ul className="divide-y divide-line">
                {latest.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0 truncate">
                        {a.contact ? (
                          <Link href={`/acquisitions/contacts/${a.contact.id}`} className="font-medium hover:underline">
                            {aqFullName(a.contact)}
                          </Link>
                        ) : (
                          <span className="font-medium">Email</span>
                        )}
                        {a.contact?.company?.name && <span className="text-muted"> · {a.contact.company.name}</span>}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted">
                        {a.direction === "OUTBOUND" ? "sent" : "received"} {fmtDate(a.occurredAt)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted">{a.subject}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
