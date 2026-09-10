import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { apartmentLine, apartmentMissing, nis } from "@/lib/israel";
import { approveApartment } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Israel dashboard. Deals to be approved: apartments that came in by email with data missing. They sit here,
 * not in the Apartments list, until the data is chased down and Jonathan approves them. Data updates is still
 * blank until Jonathan defines it.
 */
export default async function IsraelDashboard() {
  const pending = await prisma.ilApartment.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, include: { developer: { select: { name: true } }, agent: { select: { firstName: true, lastName: true, email: true } } } });
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="grid gap-4 px-8 py-5 xl:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Deals to be approved</div>
            <span className="text-xs text-muted">{pending.length}</span>
          </div>
          {pending.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">Nothing waiting. Apartments that arrive by email with data missing show up here until the data is complete and approved.</div>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((a) => {
                const missing = apartmentMissing(a as unknown as Record<string, unknown>);
                return (
                  <li key={a.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/israel/apartments/${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                        <div className="truncate text-xs text-muted">
                          {[apartmentLine(a), a.developer?.name, nis(a.priceNis) || null].filter(Boolean).join(" · ")}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          Received {fmtDate(a.createdAt)}
                          {a.agent ? ` from ${[a.agent.firstName, a.agent.lastName].filter(Boolean).join(" ") || a.agent.email}` : ""}
                          {a.source ? ` · ${a.source}` : ""}
                        </div>
                      </div>
                      {missing.length === 0 ? (
                        <form action={approveApartment.bind(null, a.id)}>
                          <button type="submit" className="btn-primary px-3 py-1.5 text-xs">
                            Approve
                          </button>
                        </form>
                      ) : (
                        <span className="chip shrink-0 bg-amber-100 text-[11px] text-amber-900">{missing.length} missing</span>
                      )}
                    </div>
                    {missing.length > 0 && <div className="mt-1.5 text-xs text-ink-soft">Still needed: {missing.join(", ")}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="card self-start">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Data updates</div>
            <span className="text-xs text-muted">0</span>
          </div>
          <div className="px-4 py-8 text-center text-sm text-muted">Nothing to review.</div>
        </div>
      </div>
    </>
  );
}
