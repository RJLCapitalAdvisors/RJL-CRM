import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Item, ItemForm } from "@/app/dash-item";
import { aqFullName, aqRoleColor, lines, parseJsonList, propertyLine } from "@/lib/acquisitions";
import { dismissCallBack } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Acquisitions dashboard: Call Me Back only. Every contact whose Call Result is Callback and whose follow-up
 * date (the callback target unless typed over) has arrived, with their numbers and the properties they are tied
 * to; it stays until dismissed. Calls are tracked on contacts since Sep 22, 2026.
 */
export default async function AcquisitionsDashboard() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const callBacks = await prisma.aqContact.findMany({
    where: { callResult: "Callback", callBackDismissedAt: null, OR: [{ followUpAt: { lte: endOfToday } }, { followUpAt: null, callBackAt: { lte: endOfToday } }] },
    orderBy: [{ followUpAt: "asc" }, { callBackAt: "asc" }],
    include: { company: { select: { name: true } }, properties: { include: { property: { select: { id: true, address: true, city: true, state: true, neighborhood: true, businessName: true } } } }, aqNotes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } },
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
            <div className="px-4 py-10 text-center text-sm text-muted">Nothing to call back today. A contact whose Call Result is Callback shows up here on their follow-up date, with the numbers to dial, until you dismiss it.</div>
          ) : (
            <ul className="divide-y divide-line">
              {callBacks.map((c) => {
                const due = c.followUpAt ?? c.callBackAt;
                const overdue = Boolean(due && due.getTime() < startOfToday);
                const phones = [c.phone, c.secondaryPhone, ...lines(c.otherPhones), c.storePhone].filter((x): x is string => Boolean(x)).filter((x, i, a) => a.indexOf(x) === i);
                return (
                  <Item key={c.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/acquisitions/contacts/${c.id}`} className="font-medium hover:underline">
                            {aqFullName(c)}
                          </Link>
                          {parseJsonList(c.roles).map((r) => (
                            <span key={r} className={`chip text-[10px] ${aqRoleColor(r)}`}>
                              {r}
                            </span>
                          ))}
                          {c.company?.name && <span className="text-xs text-muted">{c.company.name}</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">{phones.length ? phones.map((n) => <Phone key={n} n={n} />) : <span className="text-muted">no phone on file</span>}</div>
                        {c.properties.length > 0 && (
                          <div className="mt-1 text-xs text-muted">
                            {c.properties.map(({ property: p }, i) => (
                              <span key={p.id}>
                                {i > 0 && " · "}
                                <Link href={`/acquisitions/properties/${p.id}`} className="hover:underline">
                                  {p.address}
                                </Link>
                                {p.businessName ? ` (${p.businessName})` : propertyLine(p) ? ` (${propertyLine(p)})` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {c.aqNotes[0] && <div className="mt-1 text-xs text-ink-soft">{c.aqNotes[0].body}</div>}
                        <div className="mt-1 text-xs text-muted">
                          Call back {due ? fmtDate(due) : ""}
                          {overdue ? " · overdue" : ""}
                        </div>
                      </div>
                      <ItemForm action={dismissCallBack.bind(null, c.id)} className="btn-grey px-3 py-1.5 text-xs" title="Done, or no longer needed; the call result stays">
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
