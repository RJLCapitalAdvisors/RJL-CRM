import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { stageTone } from "@/lib/taxonomy";
import { RoleChips } from "@/components/ui";
import { CompanyForm } from "@/components/company-form";
import { CriteriaForm, SponsorFocusForm } from "@/components/criteria-form";
import { parseList } from "@/lib/taxonomy";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate, fullName } from "@/lib/format";
import { statusOf } from "@/lib/tracker";
import { addCompanyNote, updateCompany, updateCompanyCriteria } from "../actions";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [company, users, investorRows] = await Promise.all([
    prisma.company.findUnique({
      where: { id },
      include: {
        owner: true,
        criteria: true,
        contacts: { orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }], include: { owner: true } },
        deals: { orderBy: { updatedAt: "desc" } },
        activities: { orderBy: { occurredAt: "desc" }, take: 50, include: { contact: true, deal: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.dealInvestor.findMany({ where: { contact: { companyId: id } }, include: { deal: { select: { id: true, name: true, propertyName: true } } }, orderBy: [{ status: "desc" }, { updatedAt: "desc" }] }),
  ]);
  if (!company) notFound();
  // one row per deal this company has been sent (highest status wins)
  const sentDeals = [...new Map(investorRows.map((r) => [r.dealId, r])).values()];
  const update = updateCompany.bind(null, company.id);
  const updateCriteria = updateCompanyCriteria.bind(null, company.id);
  const addNote = addCompanyNote.bind(null, company.id);
  const roles = parseList(company.roles);
  const isInvestor = roles.some((r) => r === "Investor" || r === "Retail Investor" || r === "Lender");

  return (
    <RecordLayout
      left={
        <>
          <RecordHeader
            backHref="/companies"
            backLabel="Companies"
            initial={company.name[0]?.toUpperCase() ?? "?"}
            title={company.name}
            subtitle={[company.city, company.state].filter(Boolean).join(", ") || undefined}
            lines={[company.website ? <a href={company.website} target="_blank">{company.website.replace(/^https?:\/\//, "")}</a> : null].filter(Boolean)}
            actions={
              <>
                <Link href={`/contacts/new?companyId=${company.id}`} className="btn-secondary">
                  Add contact
                </Link>
                <RoleChips roles={company.roles} />
              </>
            }
          />
          <AboutCard title="About this company">
            <CompanyForm company={company} users={users} action={update} />
          </AboutCard>
        </>
      }
      center={
        <>
          <div className="card">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">Activity</div>
            <form action={addNote} className="flex gap-2 border-b border-line p-3">
              <input name="body" placeholder="Log a note…" className="input" />
              <button className="btn-secondary" type="submit">
                Add
              </button>
            </form>
            <ul className="divide-y divide-line">
              {company.activities.map((a) => (
                <li key={a.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="font-semibold uppercase tracking-wide">
                      {a.type}
                      {a.direction ? ` · ${a.direction.toLowerCase()}` : ""}
                    </span>
                    <span>{fmtDate(a.occurredAt)}</span>
                  </div>
                  {a.subject && <div className="mt-0.5 font-medium">{a.subject}</div>}
                  {a.body && <div className="mt-0.5 whitespace-pre-wrap text-ink-soft">{a.body}</div>}
                  {(a.contact || a.deal) && (
                    <div className="mt-1 flex gap-2 text-xs">
                      {a.contact && (
                        <Link href={`/contacts/${a.contact.id}`} className="text-sky-600 hover:underline">
                          {fullName(a.contact)}
                        </Link>
                      )}
                      {a.deal && (
                        <Link href={`/deals/${a.deal.id}`} className="text-sky-600 hover:underline">
                          {a.deal.propertyName ?? a.deal.name}
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {company.activities.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted">
                  No activity logged yet. Created {fmtDate(company.createdAt)}. Emails with anyone at this company appear here once Outlook is connected.
                </li>
              )}
            </ul>
          </div>
          {isInvestor ? (
            <div className="card">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">Investor criteria</div>
              <div className="px-4 py-2">
                <CriteriaForm criteria={company.criteria} action={updateCriteria} />
              </div>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="border-b border-line px-4 py-3 text-sm font-semibold">{roles.includes("Sponsor") ? "Sponsor focus" : "Focus"}</div>
                <div className="px-4 py-2">
                  <SponsorFocusForm criteria={company.criteria} action={updateCriteria} />
                </div>
              </div>
              <details className="card">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">Investor criteria</summary>
                <div className="border-t border-line px-4 py-2">
                  <CriteriaForm criteria={company.criteria} action={updateCriteria} />
                </div>
              </details>
            </>
          )}
        </>
      }
      right={
        <>
          <AssocCard title="Contacts" count={company.contacts.length} addHref={`/contacts/new?companyId=${company.id}`} empty="No contacts linked yet.">
            {company.contacts.map((k) => (
              <div key={k.id} className="px-4 py-2.5 text-sm">
                <Link href={`/contacts/${k.id}`} className="font-medium hover:underline">
                  {fullName(k)}
                </Link>
                <div className="truncate text-xs text-muted">
                  {k.email}
                  {k.title ? ` · ${k.title}` : ""}
                </div>
              </div>
            ))}
          </AssocCard>
          <AssocCard title="Deals" count={company.deals.length + sentDeals.length} addHref="/deals/new" empty="Deals this company sponsors, or has been sent, will show here.">
            {sentDeals.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <Link href={`/deals/${r.dealId}/tracker`} className="truncate hover:underline">
                  {r.deal.propertyName ?? r.deal.name}
                </Link>
                <span className="chip whitespace-nowrap text-[11px]" style={{ background: statusOf(r.status).bg, color: statusOf(r.status).c }}>
                  {statusOf(r.status).short}
                </span>
              </div>
            ))}
            {company.deals.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <Link href={`/deals/${d.id}`} className="truncate hover:underline">
                  {d.propertyName ?? d.name}
                </Link>
                <span className={`chip whitespace-nowrap border text-[11px] ${stageTone(d.stage)}`}>{d.stage}</span>
              </div>
            ))}
          </AssocCard>
        </>
      }
    />
  );
}
