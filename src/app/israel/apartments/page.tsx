import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IL_STAGES, apartmentLine, nisShort, pricePerSqm, stageToneIl } from "@/lib/israel";

export const metadata = { title: "Apartments" };
export const dynamic = "force-dynamic";

/** Apartments board: one column per stage, like the deals board. Click a card to open the apartment. */
export default async function ApartmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const only = typeof sp.stage === "string" ? sp.stage : null;
  const apartments = await prisma.ilApartment.findMany({ orderBy: { updatedAt: "desc" }, include: { developer: { select: { name: true } } } });
  const stages = only ? IL_STAGES.filter((s) => s === only) : IL_STAGES.filter((s) => s !== "Closed" && s !== "Lost");
  const closed = apartments.filter((a) => a.stage === "Closed" || a.stage === "Lost");
  return (
    <>
      <PageHeader
        compact
        title="Apartments"
        subtitle={`${apartments.length - closed.length} in play · ${closed.length} closed or lost`}
        actions={
          <>
            {only && (
              <Link href="/israel/apartments" className="btn-secondary">
                All stages
              </Link>
            )}
            <Link href="/israel/apartments/new" className="btn-primary">
              New apartment
            </Link>
          </>
        }
      />
      <div className="overflow-x-auto px-6 py-5">
        <div className="flex min-w-max gap-3">
          {stages.map((st) => {
            const cards = apartments.filter((a) => a.stage === st);
            return (
              <div key={st} className="w-72 shrink-0">
                <div className={`mb-2 flex items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold ${stageToneIl[st] ?? "bg-cream"}`}>
                  <span>{st}</span>
                  <span>{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.map((a) => (
                    <Link key={a.id} href={`/israel/apartments/${a.id}`} className="card block p-3 text-sm hover:border-sky-600">
                      {a.developer && <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-sky-600">{a.developer.name}</div>}
                      <div className="mt-0.5 font-medium leading-snug">{a.name}</div>
                      <div className="mt-1 text-xs text-muted">{apartmentLine(a)}</div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-muted">
                        {a.apartmentType && <span className="chip bg-cream">{a.apartmentType}</span>}
                        {a.priceNis && <span className="chip bg-sky-50">{nisShort(a.priceNis)}</span>}
                        {pricePerSqm(a.priceNis, a.internalSqm) && <span className="chip bg-cream">₪{pricePerSqm(a.priceNis, a.internalSqm)!.toLocaleString("en-US")}/m²</span>}
                      </div>
                    </Link>
                  ))}
                  {cards.length === 0 && <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-muted">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
        {!only && closed.length > 0 && (
          <div className="mt-6 text-xs text-muted">
            Closed or lost: {closed.length}.{" "}
            <Link href="/israel/apartments?stage=Closed" className="hover:underline">
              Closed
            </Link>{" "}
            ·{" "}
            <Link href="/israel/apartments?stage=Lost" className="hover:underline">
              Lost
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
