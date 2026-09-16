import Link from "next/link";
import { CA_TEAM } from "@/lib/access";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { stageTone } from "@/lib/taxonomy";
import { RoleChips } from "@/components/ui";
import { CompanyForm } from "@/components/company-form";
import { CriteriaForm, SponsorFocusForm } from "@/components/criteria-form";
import { parseList } from "@/lib/taxonomy";
import { AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { fmtDate, fullName } from "@/lib/format";
import { statusOf } from "@/lib/tracker";
import { refreshCompanyFromWebsite, updateCompany, updateCompanyCriteria } from "../actions";
import { currentUser } from "@/lib/current-user";
import { EmailLog } from "@/components/email-log";
import { kickMailSync } from "@/lib/mail-sync";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Company" };
}

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  kickMailSync();
  const [company, users, investorRows, activities] = await Promise.all([
    prisma.company.findUnique({
      where: { id },
      include: {
        owner: true,
        criteria: true,
        contacts: { orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }], include: { owner: true } },
        deals: { orderBy: { updatedAt: "desc" } },
      },
    }),
    prisma.user.findMany({ where: { active: true, ...CA_TEAM }, orderBy: { name: "asc" } }),
    prisma.dealInvestor.findMany({ where: { contact: { companyId: id } }, include: { deal: { select: { id: true, name: true, propertyName: true } } }, orderBy: [{ status: "desc" }, { updatedAt: "desc" }] }),
    // emails with anyone here, including the ones where a person here was only copied
    prisma.activity.findMany({ where: { OR: [{ companyId: id }, { parties: { some: { companyId: id } } }] }, orderBy: { occurredAt: "desc" }, take: 100, include: { contact: { select: { id: true, firstName: true, lastName: true } }, deal: { select: { id: true, name: true, propertyName: true } } } }),
  ]);
  if (!company) notFound();
  // one row per deal this company has been sent (highest status wins)
  const sentDeals = [...new Map(investorRows.map((r) => [r.dealId, r])).values()];
  const update = updateCompany.bind(null, company.id);
  const updateCriteria = updateCompanyCriteria.bind(null, company.id);
  const refresh = refreshCompanyFromWebsite.bind(null, company.id);
  const roles = parseList(company.roles);
  const isInvestor = roles.some((r) => r === "Investor" || r === "Retail Investor" || r === "Lender");
  const canEdit = Boolean((await currentUser())?.canEditCriteria);
  const site = company.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

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
            lines={[
              company.website ? (
                <a key="web" href={company.website} target="_blank">
                  {site}
                </a>
              ) : null,
              company.description ? (
                <span key="desc" className="block whitespace-normal text-ink-soft">
                  {company.description}
                </span>
              ) : null,
            ].filter(Boolean)}
            actions={
              <>
                <Link href={`/contacts/new?companyId=${company.id}`} className="btn-secondary">
                  Add contact
                </Link>
                {(company.domain || company.website) && (
                  <form action={refresh}>
                    <button className="btn-secondary" type="submit" title={company.enrichedAt ? `Last read ${fmtDate(company.enrichedAt)}. Fills blanks from the website; never overwrites what you typed.` : "Read the website and fill in the blanks"}>
                      Refresh from website
                    </button>
                  </form>
                )}
                <RoleChips roles={company.roles} />
              </>
            }
          />
          <details className="card">
            <summary className="cursor-pointer border-b border-line px-4 py-3 text-sm font-semibold">About this company</summary>
            <div className="px-4 py-2">
              <CompanyForm company={company} users={users} action={update} autosave />
            </div>
          </details>
          {isInvestor ? (
            <div className="card">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">Role and investor criteria</div>
              <div className="px-4 py-2">
                {!canEdit && <div className="mb-2 rounded-md bg-cream px-3 py-2 text-xs text-ink-soft">Changes you save here go to Jonathan for approval before they take effect.</div>}
                <CriteriaForm criteria={company.criteria} roles={roles} action={updateCriteria} />
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">{roles.includes("Sponsor") ? "Role and sponsor focus" : "Role and focus"}</div>
              <div className="px-4 py-2">
                {!canEdit && <div className="mb-2 rounded-md bg-cream px-3 py-2 text-xs text-ink-soft">Changes you save here go to Jonathan for approval before they take effect.</div>}
                <SponsorFocusForm criteria={company.criteria} roles={roles} action={updateCriteria} />
              </div>
            </div>
          )}
        </>
      }
      center={<EmailLog rows={activities} title="Activity" empty="No emails or notes with this company yet. Emails any of the team sends or receives show up here." />}
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
