import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { apartmentLine, apartmentMissing, houseLine, houseMissing, ilFullName, nis } from "@/lib/israel";
import { approveApartment, approveHouse } from "./actions";
import { kickIsraelMailSync } from "@/lib/israel-mail";
import { IL_MENTIONED } from "@/lib/israel-mentions";
import { dismissIlMention } from "./actions";
import { Item, ItemForm } from "@/app/dash-item";
import { loadIlRequired } from "@/lib/required-items";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Israel dashboard. Deals to be approved: apartments that came in by email with data missing. They sit here,
 * not in the Apartments list, until the data is chased down and Jonathan approves them. Deals mentioned carries
 * properties people floated by email without ever sending the listing. Data updates lists tickets a later message
 * added data to. Three windows, none replacing another.
 */
export default async function IsraelDashboard() {
  kickIsraelMailSync(); // emails from the RJL Israel mailboxes land on contacts and companies in the background
  await loadIlRequired(); // Still needed reads the Required Items Lists as Jonathan last edited them
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [pendingApts, pendingHouses, mentions, updates] = await Promise.all([
    prisma.ilApartment.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, include: { developer: { select: { name: true } }, agent: { select: { firstName: true, lastName: true, email: true } } } }),
    prisma.ilHouse.findMany({ where: { pendingApproval: true }, orderBy: { createdAt: "desc" }, include: { developer: { select: { name: true } }, agent: { select: { firstName: true, lastName: true, email: true } } } }),
    prisma.ilDeal.findMany({ where: { stage: IL_MENTIONED }, orderBy: { updatedAt: "desc" }, include: { agent: { select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } } } } }),
    // tickets a later email or WhatsApp message added data to (the intake writes an "Updated from ..." note)
    prisma.ilNote.findMany({ where: { body: { startsWith: "Updated from" }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 30, include: { apartment: { select: { id: true, name: true } }, house: { select: { id: true, name: true } } } }),
  ]);
  // apartments and houses in one list, newest first
  const pending = [
    ...pendingApts.map((a) => ({ id: a.id, kind: "apartments" as const, name: a.name, line: apartmentLine(a), developer: a.developer?.name, price: a.priceNis, createdAt: a.createdAt, agent: a.agent, source: a.source, missing: apartmentMissing(a as unknown as Record<string, unknown>) })),
    ...pendingHouses.map((h) => ({ id: h.id, kind: "houses" as const, name: h.name, line: houseLine(h), developer: h.developer?.name, price: h.priceNis, createdAt: h.createdAt, agent: h.agent, source: h.source, missing: houseMissing(h as unknown as Record<string, unknown>) })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
            <div className="px-4 py-8 text-center text-sm text-muted">Nothing waiting. Apartments and houses that arrive by email or WhatsApp with data missing show up here until the data is complete and approved.</div>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((a) => {
                const missing = a.missing;
                return (
                  <li key={`${a.kind}-${a.id}`} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/israel/${a.kind}/${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                        <span className="ml-2 chip bg-cream text-[10px]">{a.kind === "houses" ? "House" : "Apartment"}</span>
                        <div className="truncate text-xs text-muted">
                          {[a.line, a.developer, nis(a.price) || null].filter(Boolean).join(" · ")}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          Received {fmtDate(a.createdAt)}
                          {a.agent ? ` from ${[a.agent.firstName, a.agent.lastName].filter(Boolean).join(" ") || a.agent.email}` : ""}
                          {a.source ? ` · ${a.source}` : ""}
                        </div>
                      </div>
                      {missing.length === 0 ? (
                        <form action={(a.kind === "houses" ? approveHouse : approveApartment).bind(null, a.id)}>
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
            <span className="text-xs text-muted">{updates.length}</span>
          </div>
          {updates.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">Nothing in the last two weeks. When a second email or WhatsApp message about a unit we already have adds data to its ticket, it shows here.</div>
          ) : (
            <ul className="divide-y divide-line">
              {updates.map((u) => {
                const unit = u.apartment ? { href: `/israel/apartments/${u.apartment.id}`, name: u.apartment.name, kind: "Apartment" } : u.house ? { href: `/israel/houses/${u.house.id}`, name: u.house.name, kind: "House" } : null;
                if (!unit) return null;
                return (
                  <li key={u.id} className="px-4 py-3 text-sm">
                    <Link href={unit.href} className="font-medium hover:underline">
                      {unit.name}
                    </Link>
                    <span className="ml-2 chip bg-cream text-[10px]">{unit.kind}</span>
                    <div className="mt-0.5 text-xs text-muted">{u.body.replace(/^Updated from /, "Updated from ")} · {fmtDate(u.createdAt)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="card self-start">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Deals mentioned</div>
            <span className="text-xs text-muted">{mentions.length}</span>
          </div>
          {mentions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">Nothing yet. A property someone mentions in an email to an RJL Israel mailbox, without sending the listing, shows up here and in the Mentioned column under Deals.</div>
          ) : (
            <ul className="divide-y divide-line">
              {mentions.map((m) => (
                <Item key={m.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/israel/deals/${m.id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-ink-soft">{m.description}</div>
                      <div className="mt-1 text-xs text-muted">
                        {[m.agent ? `from ${ilFullName(m.agent)}` : null, m.agent?.company?.name, m.offerNis ? nis(m.offerNis) : null, `mentioned ${fmtDate(m.updatedAt)}`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <ItemForm action={dismissIlMention.bind(null, m.id)} className="btn-grey shrink-0 px-3 py-1.5 text-xs" title="Not something we are looking at; takes it off this list and out of the funnel">
                      Dismiss
                    </ItemForm>
                  </div>
                </Item>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
