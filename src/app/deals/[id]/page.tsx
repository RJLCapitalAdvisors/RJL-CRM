import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DealForm } from "@/components/deal-form";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { CompanyLogo } from "@/components/company-logo";
import { fmtDate, fullName } from "@/lib/format";
import { TRACKER_STATUSES, investorLabel, statusOf } from "@/lib/tracker";
import { addDealNote, updateDeal } from "../actions";
import { StageSelect } from "./stage-select";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, users] = await Promise.all([
    prisma.deal.findUnique({
      where: { id },
      include: {
        owner: true,
        sponsorCompany: { include: { contacts: { where: { email: { not: null } }, orderBy: { lastActivityAt: "desc" }, take: 8 } } },
        activities: { orderBy: { occurredAt: "desc" }, take: 60, include: { contact: { include: { company: true } } } },
        investors: { include: { contact: { include: { company: true } } }, orderBy: [{ status: "desc" }, { updatedAt: "desc" }] },
        campaigns: { select: { id: true, name: true, followUp: true, createdAt: true, recipients: { select: { status: true } } }, orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!deal) notFound();
  const update = updateDeal.bind(null, deal.id);
  const addNote = addDealNote.bind(null, deal.id);
  const name = deal.propertyName ?? deal.name;
  const counts = new Map<number, number>();
  for (const r of deal.investors) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const sent = deal.campaigns.reduce((n, c) => n + c.recipients.filter((r) => r.status === "SENT").length, 0);

  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/deals"
            backLabel="Deals"
            initial={(deal.sponsorName?.[0] ?? name[0] ?? "?").toUpperCase()}
            title={name}
            subtitle={deal.sponsorName ?? undefined}
            lines={[<StageSelect key="stage" dealId={deal.id} stage={deal.stage} />]}
            actions={
              <>
                <Link href={`/campaigns/new?dealId=${deal.id}`} className="btn-primary">
                  Send deal
                </Link>
                <Link href={`/deals/${deal.id}/tracker`} className="btn-secondary">
                  Progress report
                </Link>
                <Link href={`/investors?dealId=${deal.id}`} className="btn-secondary">
                  Find investors
                </Link>
                <Link href={`/investors?dealId=${deal.id}&mode=engagement`} className="btn-secondary" title="Pick the equity groups to carve out, then the letter drafts itself to the sponsor">
                  Generate engagement letter
                </Link>
              </>
            }
          />
          <AboutCard title="About this deal">
            <DealForm deal={deal} users={users} action={update} />
          </AboutCard>
        </>
      }
      center={
        <>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Emails and notes on this deal</h2>
              <span className="text-xs text-muted">{sent} deal emails sent</span>
            </div>
            <form action={addNote} className="flex gap-2 border-b border-line p-3">
              <input name="body" placeholder="Log a note…" className="input" />
              <button className="btn-secondary" type="submit">
                Add
              </button>
            </form>
            <ul className="divide-y divide-line">
              {deal.activities.map((a) => (
                <li key={a.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="font-semibold uppercase tracking-wide">
                      {a.type}
                      {a.direction ? ` · ${a.direction.toLowerCase()}` : ""}
                      {a.contact && (
                        <>
                          {" · "}
                          <Link href={`/contacts/${a.contact.id}`} className="normal-case tracking-normal text-sky-600 hover:underline">
                            {fullName(a.contact)}
                          </Link>
                          {a.contact.company ? ` (${a.contact.company.name})` : ""}
                        </>
                      )}
                    </span>
                    <span>{fmtDate(a.occurredAt)}</span>
                  </div>
                  {a.subject && <div className="mt-0.5 font-medium">{a.subject}</div>}
                  {a.body && <div className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-ink-soft">{a.body}</div>}
                </li>
              ))}
              {deal.activities.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Emails you send from the outreach queue, forwarded emails, and notes land here.</li>}
            </ul>
          </div>
        </>
      }
      right={
        <>
          <AssocCard title="Sponsor" count={deal.sponsorCompany ? 1 : 0} empty="No sponsor company linked. Type the sponsor name on the left and save.">
            {deal.sponsorCompany && (
              <div className="p-4 text-sm">
                <Link href={`/companies/${deal.sponsorCompany.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                  <CompanyLogo domain={deal.sponsorCompany.domain} name={deal.sponsorCompany.name} />
                  {deal.sponsorCompany.name}
                </Link>
                {(deal.sponsorCompany.city || deal.sponsorCompany.state) && <div className="mt-1 text-xs text-muted">{[deal.sponsorCompany.city, deal.sponsorCompany.state].filter(Boolean).join(", ")}</div>}
              </div>
            )}
          </AssocCard>
          <AssocCard title="Contacts" count={deal.sponsorCompany?.contacts.length ?? 0} addHref={deal.sponsorCompany ? `/contacts/new?companyId=${deal.sponsorCompany.id}` : undefined} empty="Sponsor-side contacts appear here.">
            {deal.sponsorCompany?.contacts.map((k) => (
              <div key={k.id} className="px-4 py-2 text-sm">
                <Link href={`/contacts/${k.id}`} className="hover:underline">
                  {fullName(k)}
                </Link>
                <div className="truncate text-xs text-muted">{k.email}</div>
              </div>
            ))}
          </AssocCard>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Progress report ({deal.investors.length})</div>
              <Link href={`/deals/${deal.id}/tracker`} className="text-xs font-medium text-sky-600 hover:underline">
                Open
              </Link>
            </div>
            {deal.investors.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted">Investors you send this deal to show up here with their status.</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1 px-4 py-3">
                  {[...TRACKER_STATUSES].reverse().map((s) => {
                    const n = counts.get(s.id) ?? 0;
                    return n ? (
                      <span key={s.id} className="chip text-[11px]" style={{ background: s.bg, color: s.c }}>
                        {s.short} {n}
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="divide-y divide-line border-t border-line">
                  {deal.investors.slice(0, 8).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                      <span className="truncate">{investorLabel(r.contact)}</span>
                      <span className="chip shrink-0 text-[10px]" style={{ background: statusOf(r.status).bg, color: statusOf(r.status).c }}>
                        {statusOf(r.status).short}
                      </span>
                    </div>
                  ))}
                  {deal.investors.length > 8 && (
                    <Link href={`/deals/${deal.id}/tracker`} className="block px-4 py-2 text-center text-xs text-sky-600 hover:underline">
                      All {deal.investors.length} on the report
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      }
    />
  );
}
