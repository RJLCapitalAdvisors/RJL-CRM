import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DealForm } from "@/components/deal-form";
import { AboutCard, AssocCard, RecordHeader, RecordLayout } from "@/components/record-layout";
import { CompanyLogo } from "@/components/company-logo";
import { fmtDate, fullName } from "@/lib/format";
import { TRACKER_STATUSES, investorLabel, statusOf } from "@/lib/tracker";
import { addDealNote, deleteFact, updateDeal , toggleFactFaq } from "../actions";
import { StageSelect } from "./stage-select";
import { AttachmentList } from "@/components/attachment-list";
import { signFileToken } from "@/lib/tokens";
import { faqFileName } from "@/lib/faq-pdf";
import { EngagementCard } from "./engagement-card";
import { SendToOne } from "./send-to-one";
import { engagementGroups } from "@/lib/send-deal";
import { EmailLog } from "@/components/email-log";
import { dealEmailRows } from "@/lib/deal-emails";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: d ? d.propertyName ?? d.name : "Deal" };
}

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, users] = await Promise.all([
    prisma.deal.findUnique({
      where: { id },
      include: {
        owner: true,
        sponsorCompany: { include: { contacts: { where: { email: { not: null }, departedAt: null }, orderBy: { lastActivityAt: "desc" }, take: 8 } } },
        activities: { orderBy: { occurredAt: "desc" }, take: 60, include: { contact: { include: { company: true } } } },
        investors: { include: { contact: { include: { company: true } } }, orderBy: [{ status: "desc" }, { updatedAt: "desc" }] },
        campaigns: { select: { id: true, name: true, followUp: true, createdAt: true, recipients: { select: { status: true } } }, orderBy: { createdAt: "desc" } },
        files: { orderBy: { receivedAt: "desc" } },
        facts: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!deal) notFound();
  const showEngagement = deal.stage === "Engagement Letter Sent" || deal.stage === "Engagement Letter Signed";
  const groups = showEngagement ? (await engagementGroups(deal.id)).filter((g) => g.companyId).map((g) => ({ companyId: g.companyId, name: g.name, status: g.status })) : [];
  const emails = [...(await dealEmailRows(deal.id)), ...deal.activities.filter((a) => a.type !== "EMAIL")].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
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
                <Link href={`/deals/${deal.id}/send`} className="btn-primary" title="Draft the deal email to each agreed group from your template, pick the people, review, send one by one">
                  Send deal
                </Link>
                <Link href={`/deals/${deal.id}/tracker`} className="btn-secondary">
                  Progress report
                </Link>
                <SendToOne dealId={deal.id} />
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
            <DealForm deal={deal} users={users} action={update} autosave />
          </AboutCard>
        </>
      }
      center={
        <>
          {showEngagement && <EngagementCard dealId={deal.id} groups={groups} signed={deal.stage === "Engagement Letter Signed"} />}
          <EmailLog
            rows={emails}
            title="Emails on this deal"
            aside={`${emails.filter((e) => e.type === "EMAIL").length} emails · ${sent} sent from the CRM`}
            empty="Nothing yet. Emails the team sends or receives about this deal (to LPs, with the sponsor, through deals@) and notes land here."
            toolbar={
              <form action={addNote} className="flex gap-2 border-b border-line p-3">
                <input name="body" placeholder="Log a note…" className="input" />
                <button className="btn-secondary" type="submit">
                  Add
                </button>
              </form>
            }
          />
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
          <AssocCard title="Attachments" count={deal.files.length + (deal.facts.length ? 1 : 0)} empty="Files the sponsor sends on this deal (through deals@) collect here.">
            <AttachmentList
              files={[
                ...(deal.facts.some((f) => f.inFaq) ? [{ id: "faq", kind: "faq" as const, name: faqFileName(name), size: 0, date: "built from Questions answered", url: `/api/deals/${deal.id}/faq.pdf?t=${signFileToken(`faq:${deal.id}`)}` }] : []),
                ...deal.files.map((f) => ({ id: f.id, name: f.name, size: f.size, date: fmtDate(f.receivedAt), url: `/api/deals/${deal.id}/files/${f.id}?t=${signFileToken(`file:${f.id}`)}` })),
              ]}
            />
          </AssocCard>
          <AssocCard title="Questions answered" count={deal.facts.length} empty="What the sponsor tells us in follow-up emails is filed here and used to answer investor questions. Items marked FAQ go out with the deal; only questions somebody actually asked belong there.">
            {deal.facts.map((f) => (
              <div key={f.id} className="group px-4 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">
                    {f.question}
                    {f.inFaq && <span className="chip ml-2 bg-sky text-[10px]" title="On the Investor FAQ that goes out with the deal">FAQ</span>}
                  </div>
                  <form action={toggleFactFaq.bind(null, deal.id, f.id)}>
                    <button type="submit" className="shrink-0 text-[11px] text-muted opacity-0 transition-opacity hover:underline group-hover:opacity-100" title={f.inFaq ? "Take this off the Investor FAQ (it stays on the ticket)" : "Put this on the Investor FAQ (only questions somebody actually asked belong there)"}>
                      {f.inFaq ? "off FAQ" : "to FAQ"}
                    </button>
                  </form>
                  <form action={deleteFact.bind(null, deal.id, f.id)}>
                    <button type="submit" className="shrink-0 text-[11px] text-muted opacity-0 transition-opacity hover:underline group-hover:opacity-100" title="Take this off the ticket and out of the Investor FAQ">
                      remove
                    </button>
                  </form>
                </div>
                <div className="text-ink-soft">{f.answer}</div>
                {f.source && <div className="mt-0.5 text-[11px] text-muted">{f.source}</div>}
              </div>
            ))}
          </AssocCard>
        </>
      }
    />
  );
}
