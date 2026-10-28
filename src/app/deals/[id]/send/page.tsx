import Link from "next/link";
import { CA_TEAM } from "@/lib/access";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { templateForDeal } from "@/lib/deal-template";
import { currentUser } from "@/lib/current-user";
import { PageHeader } from "@/components/ui";
import { dealFiles, syncSendDrafts, usualRecipientsMany } from "@/lib/send-deal";
import { SendClient, type Firm, type SendState } from "./send-client";
import { SendToOne } from "../send-to-one";
import { after } from "next/server";
import { launchStatus, pumpLaunches } from "@/lib/launch-queue";
import { brochureInfo, BROCHURE_KEY, ensureOutreachTemplate, isOutreach } from "@/lib/outreach";
import { BrochureCard } from "@/components/brochure-card";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `Send ${d ? d.propertyName ?? d.name : "deal"}` };
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a launch paces itself: one email at a time, a second or two apart

/** Send deal: pick who at each agreed firm gets it, personalize the first line, review, then drafts land in your Outlook to fire one by one. */
export default async function SendDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await syncSendDrafts().catch(() => 0);
  const deal = await prisma.deal.findUnique({ where: { id }, include: { investors: { include: { contact: { include: { company: { include: { contacts: { where: { email: { not: null }, departedAt: null }, orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }] } } } } } }, orderBy: { createdAt: "asc" } } } });
  if (!deal) notFound();
  // a reach out (Investor search > Reach out, Oct 28, 2026): the same page, its own template kind, the brochure as the file
  const outreach = isOutreach(deal);
  const templates = outreach ? await ensureOutreachTemplate() : await prisma.emailTemplate.findMany({ where: { kind: "DEAL", workspace: "CA", NOT: { OR: [{ name: { contains: "Engagement" } }, { name: { startsWith: "(archived)" } }] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const brochure = outreach ? await brochureInfo().catch(() => null) : null;
  const name = deal.propertyName ?? deal.name;
  const fitting = deal && !outreach ? await templateForDeal(deal).catch(() => null) : null;
  const house = (fitting && templates.find((t) => t.id === fitting.id)) ?? templates.find((t) => t.name.startsWith("Deal email (house")) ?? templates[0];

  const me = await currentUser();
  const files = await dealFiles(deal.id).catch(() => []);
  // a preview link per file: the DealFile row behind each key, signed like the ticket's attachment links
  const { signFileToken } = await import("@/lib/tokens");
  const rows = await (await import("@/lib/send-deal")).fileRowsFor(deal.id);
  const fileUrl = (key: string) => {
    if (key === "faq") return `/api/deals/${deal.id}/faq.pdf`;
    if (key === BROCHURE_KEY) return "/api/outreach/brochure";
    const r = rows.find((x) => `${x.graphId}::${x.attachmentId}` === key);
    return r ? `/api/deals/${deal.id}/files/${r.id}?t=${signFileToken(`file:${r.id}`)}&preview=1` : null;
  };
  // a launch still going (or left behind when the tab closed): the page resumes pacing it and pumps in the background
  const launch = await launchStatus(deal.id).catch(() => null);
  const bouncedEmails = new Set((launch?.rows ?? []).flatMap((r) => r.bounced ?? []));
  // the minute scheduler keeps a launch going; the page's own poll sends what is due while it is open (a long pump here was one of three that woke together, Oct 7, 2026)
  if (launch && launch.queued > 0 && me && !process.env.CRON_SECRET) after(() => pumpLaunches(me.email, 270_000).catch(() => null));
  const team = (await prisma.user.findMany({ where: { active: true, ...CA_TEAM, email: { not: null } }, select: { name: true, email: true }, orderBy: { name: "asc" } })).filter((u) => u.email && u.email.toLowerCase() !== me?.email?.toLowerCase()).map((u) => ({ name: u.name, email: u.email! }));
  const sendStateSaved = ((): SendState | null => {
    try {
      const st = (JSON.parse(deal.details || "{}") as { sendState?: SendState }).sendState;
      return st && typeof st === "object" ? st : null;
    } catch {
      return null;
    }
  })();
  // the person opening the page gets their own signature on the saved email and their own CC list (sender.ts, Oct 27, 2026)
  const sendStateAdopted = me?.email ? await (await import("@/lib/sender")).adoptSendState(sendStateSaved, me.email) : sendStateSaved;
  // a reach out always carries the brochure: a page opened (and autosaved) before the brochure was on file ticks it on the next open
  const sendState = outreach && brochure && sendStateAdopted ? { ...sendStateAdopted, chosenFiles: [...new Set([...(sendStateAdopted.chosenFiles ?? []), BROCHURE_KEY])] } : sendStateAdopted;
  // who to tick at each firm: every firm in one pass (replies, calls and the outbound log)
  const defaults = await usualRecipientsMany(new Map(deal.investors.filter((r) => r.contact.companyId).map((r) => [r.contact.companyId!, r.contact.company?.contacts ?? []]))).catch(() => new Map<string, string[]>());
  // people who left these firms lately, with the colleague their notice named: the replacement is ticked in their place (Oct 27, 2026)
  const { recentDepartures } = await import("@/lib/departures");
  const departures = await recentDepartures([...new Set(deal.investors.map((r) => r.contact.companyId).filter((x): x is string => Boolean(x)))]).catch(() => new Map());
  const firms: Firm[] = deal.investors.map((r) => ({
    rowId: r.id,
    status: r.status,
    company: r.contact.company?.name ?? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
    domain: r.contact.company?.domain ?? null,
    people: (r.contact.company?.contacts ?? [{ id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, email: r.contact.email, title: null }]).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "", firstName: c.firstName ?? "", email: c.email ?? "", title: c.title ?? null, bounced: Boolean(c.email && bouncedEmails.has(c.email.toLowerCase())) })),
    primaryContactId: r.contactId,
    // starred on the company page: the people the email is addressed to (their first names in the greeting)
    addressTo: (r.contact.company?.contacts ?? []).filter((c) => c.dealAddress).map((c) => c.id),
    extraContactIds: r.extraContactIds ? (JSON.parse(r.extraContactIds) as string[]) : [],
    // who we usually write to at this firm (from the email log); falls back to the report's contact
    // a reach out goes to one person per firm by default (Jonathan, Oct 28, 2026): the best-ranked of the usual recipients
    defaultContactIds: (r.contact.companyId && defaults.get(r.contact.companyId)?.length ? defaults.get(r.contact.companyId)! : [r.contactId]).slice(0, outreach ? 1 : undefined),
    openingLine: r.openingLine,
    bodyOverride: r.bodyOverride,
    draftOpen: Boolean(r.sendDraftId),
    departures: (r.contact.companyId ? departures.get(r.contact.companyId) ?? [] : []).map((d: { contactId: string; name: string; replacements: string[] }) => ({ contactId: d.contactId, name: d.name, replacements: d.replacements })),
  }));

  return (
    <>
      <PageHeader
        title={outreach ? name : `Send ${name}`}
        subtitle={`${firms.filter((f) => f.status <= 1).length} firms not yet sent · ${firms.filter((f) => f.status >= 2).length} sent earlier (turn one on with + to send it the current email again)${outreach ? " · the brochure goes on every email; the launch paces itself like a deal send" : ""}`}
        actions={
          <>
            <SendToOne dealId={deal.id} />
            {outreach && (
              <Link href={`/investors/reach/${deal.id}/followup`} className="btn-secondary">
                Follow ups
              </Link>
            )}
            <Link href={outreach ? "/investors" : `/deals/${deal.id}`} className="btn-secondary">
              {outreach ? "Back to Investor search" : "Back to deal"}
            </Link>
          </>
        }
      />
      {outreach && (
        <div className="px-8 pt-4">
          <BrochureCard brochure={brochure ? { name: brochure.name, size: brochure.size, uploadedAt: brochure.uploadedAt, by: brochure.by } : null} />
        </div>
      )}
      <SendClient dealId={deal.id} firms={firms} templates={templates} defaultTemplateId={house?.id ?? ""} files={files.map((f) => ({ key: f.key, name: f.name, size: f.size, url: fileUrl(f.key) }))} saved={sendState} team={team} initialLaunch={launch && (launch.queued > 0 || launch.failed > 0 || launch.bounced > 0) ? launch : null} filesEmptyNote={outreach ? "Attachments: no brochure on file yet. Add it above and it is ticked here for every email." : undefined} />
    </>
  );
}
