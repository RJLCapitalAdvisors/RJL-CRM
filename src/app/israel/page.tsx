import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { ilFullName, nis } from "@/lib/israel";
import { kickIsraelMailSync } from "@/lib/israel-mail";
import { IL_MENTIONED } from "@/lib/israel-mentions";
import { dismissIlMention, snoozeIlMention } from "./actions";
import { Item, ItemForm } from "@/app/dash-item";
import { loadIlRequired } from "@/lib/required-items";
import { pricingDue, PRICE_CHECK_DAYS } from "@/lib/israel-pricing";
import { markPriceChecked } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * RJL Israel dashboard. Everything that came in waits in The Que until approved (the Deals to be approved window
 * that used to sit here went on Sep 23, 2026: The Que is the one place). Deals mentioned carries
 * properties people floated by email without ever sending the listing. Data updates lists tickets a later message
 * added data to. Pricing updates asks, every three months per apartment, house and project, for the pricing to be
 * checked with the agent or developer. Three windows, none replacing another.
 */
export default async function IsraelDashboard() {
  kickIsraelMailSync(); // emails from the RJL Israel mailboxes land on contacts and companies in the background
  await loadIlRequired(); // Still needed reads the Required Items Lists as Jonathan last edited them
  const since = new Date(Date.now() - 14 * 86_400_000);
  const pricing = await pricingDue(40);
  const [mentions, updates] = await Promise.all([
    prisma.ilDeal.findMany({ where: { stage: IL_MENTIONED, OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }] }, orderBy: { updatedAt: "desc" }, include: { agent: { select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } } } } }),
    // tickets a later email or WhatsApp message added data to (the intake writes an "Updated from ..." note)
    prisma.ilNote.findMany({ where: { body: { startsWith: "Updated from" }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 30, include: { apartment: { select: { id: true, name: true } }, house: { select: { id: true, name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="grid gap-4 px-8 py-5 xl:grid-cols-2">
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
                    <div className="flex shrink-0 flex-col gap-1">
                      <ItemForm action={snoozeIlMention.bind(null, m.id)} className="btn-grey px-3 py-1.5 text-xs" title="Out of sight for a week, then back here">
                        Snooze a week
                      </ItemForm>
                      <ItemForm action={dismissIlMention.bind(null, m.id)} className="btn-grey px-3 py-1.5 text-xs" title="Not something we are looking at; takes it off this list and out of the funnel">
                        Dismiss
                      </ItemForm>
                    </div>
                  </div>
                </Item>
              ))}
            </ul>
          )}
        </div>
        <div className="card self-start">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Pricing updates</div>
            <span className="text-xs text-muted">{pricing.total}</span>
          </div>
          {pricing.rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">Every apartment, house and project asks for a pricing check every {PRICE_CHECK_DAYS} days. Nothing is due right now.</div>
          ) : (
            <ul className="divide-y divide-line">
              {pricing.rows.map((r) => (
                <Item key={`${r.kind}-${r.id}`} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/israel/${r.kind}/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="ml-2 chip bg-cream text-[10px]">{r.kind === "houses" ? "House" : r.kind === "projects" ? "Project" : "Apartment"}</span>
                      <div className="mt-0.5 text-xs text-muted">
                        {[r.place, r.priceNis != null ? `asking ${nis(r.priceNis)}` : r.kind === "projects" ? "unit pricing" : "no asking price on file", r.who ? `ask ${r.who}` : null].filter(Boolean).join(" · ")}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {r.lastChecked ? `Last checked ${fmtDate(r.lastChecked)}` : `Never checked; on file since ${fmtDate(r.since)}`}
                        {r.daysOver > 0 ? ` · ${r.daysOver} day${r.daysOver === 1 ? "" : "s"} overdue` : " · due today"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <ItemForm action={markPriceChecked.bind(null, r.kind, r.id)} className="btn-primary px-3 py-1.5 text-xs" title="The pricing was checked and the ticket is right; ask again in three months">
                        Pricing confirmed
                      </ItemForm>
                      <Link href={`/israel/${r.kind}/${r.id}`} className="btn-grey px-3 py-1.5 text-center text-xs" title="Open the ticket to change the asking price; a saved price change counts as a check">
                        Update price
                      </Link>
                    </div>
                  </div>
                </Item>
              ))}
              {pricing.total > pricing.rows.length && <li className="px-4 py-2 text-xs text-muted">{pricing.total - pricing.rows.length} more after these.</li>}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
