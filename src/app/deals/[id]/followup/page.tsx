import Link from "next/link";
import { CA_TEAM } from "@/lib/access";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { templateForDeal } from "@/lib/deal-template";
import { currentUser } from "@/lib/current-user";
import { PageHeader } from "@/components/ui";
import { dealFiles, syncSendDrafts, usualRecipients } from "@/lib/send-deal";
import { SendClient, type Firm, type SendState } from "../send/send-client";
import { SendToOne } from "../send-to-one";
import { after } from "next/server";
import { firstSentMessageId, launchStatus, pumpLaunches } from "@/lib/launch-queue";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `Follow ups ${d ? d.propertyName ?? d.name : ""}` };
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a launch paces itself: one email at a time, a second or two apart

/** Send deal: pick who at each agreed firm gets it, personalize the first line, review, then drafts land in your Outlook to fire one by one. */
/** Follow ups: the Send deal page again, but every email is a reply-all on the deal email that firm was sent, and firms that answered or passed are shaded out (Jonathan, Oct 1, 2026). */
export default async function FollowUpsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await syncSendDrafts().catch(() => 0);
  const [deal, templates] = await Promise.all([
    prisma.deal.findUnique({ where: { id }, include: { investors: { include: { contact: { include: { company: { include: { contacts: { where: { email: { not: null }, departedAt: null }, orderBy: [{ lastActivityAt: "desc" }, { lastName: "asc" }] } } } } } }, orderBy: { createdAt: "asc" } } } }),
    prisma.emailTemplate.findMany({ where: { kind: "DEAL", workspace: "CA", NOT: { OR: [{ name: { contains: "Engagement" } }, { name: { startsWith: "(archived)" } }] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!deal) notFound();
  const name = deal.propertyName ?? deal.name;
  const fitting = deal ? await templateForDeal(deal).catch(() => null) : null;
  const house = (fitting && templates.find((t) => t.id === fitting.id)) ?? templates.find((t) => t.name.startsWith("Deal email (house")) ?? templates[0];

  const me = await currentUser();
  const files = await dealFiles(deal.id).catch(() => []);
  // a preview link per file: the DealFile row behind each key, signed like the ticket's attachment links
  const { signFileToken } = await import("@/lib/tokens");
  const rows = await prisma.dealFile.findMany({ where: { OR: [{ dealId: deal.id }, { deal: { parentDealId: deal.id } }] }, select: { id: true, graphId: true, attachmentId: true } });
  const fileUrl = (key: string) => {
    if (key === "faq") return `/api/deals/${deal.id}/faq.pdf`;
    const r = rows.find((x) => `${x.graphId}::${x.attachmentId}` === key);
    return r ? `/api/deals/${deal.id}/files/${r.id}?t=${signFileToken(`file:${r.id}`)}&preview=1` : null;
  };
  // a launch still going (or left behind when the tab closed): the page resumes pacing it and pumps in the background
  if (me) await import("@/lib/launch-queue").then((m) => m.scanLaunchBounces(me.email)).catch(() => 0); // bounces since the last launch
  const launch = await launchStatus(deal.id, "FOLLOWUP").catch(() => null);
  const bouncedEmails = new Set((launch?.rows ?? []).flatMap((r) => r.bounced ?? []));
  if (launch && launch.queued > 0 && me) after(() => pumpLaunches(me.email, 270_000).catch(() => null));
  const team = (await prisma.user.findMany({ where: { active: true, ...CA_TEAM, email: { not: null } }, select: { name: true, email: true }, orderBy: { name: "asc" } })).filter((u) => u.email && u.email.toLowerCase() !== me?.email?.toLowerCase()).map((u) => ({ name: u.name, email: u.email! }));
  const sendState = ((): SendState | null => {
    try {
      const st = (JSON.parse(deal.details || "{}") as { followupState?: SendState }).followupState;
      return st && typeof st === "object" ? st : null;
    } catch {
      return null;
    }
  })();
  const defaults = new Map<string, string[]>();
  for (const r of deal.investors) {
    if (r.contact.companyId && !defaults.has(r.contact.companyId)) defaults.set(r.contact.companyId, await usualRecipients(r.contact.companyId, r.contact.company?.contacts ?? []));
  }
  const sentOn = new Map<string, { messageId: string; sentAt: Date } | null>();
  for (const r of deal.investors) sentOn.set(r.id, await firstSentMessageId(deal.id, r.id).catch(() => null));
  const firms: Firm[] = deal.investors.map((r) => ({
    rowId: r.id,
    followupTo: sentOn.get(r.id)?.messageId ?? null,
    sentOn: sentOn.get(r.id)?.sentAt.toISOString() ?? null,
    status: r.status,
    company: r.contact.company?.name ?? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
    domain: r.contact.company?.domain ?? null,
    people: (r.contact.company?.contacts ?? [{ id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, email: r.contact.email, title: null }]).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "", firstName: c.firstName ?? "", email: c.email ?? "", title: c.title ?? null, bounced: Boolean(c.email && bouncedEmails.has(c.email.toLowerCase())) })),
    primaryContactId: r.contactId,
    extraContactIds: r.extraContactIds ? (JSON.parse(r.extraContactIds) as string[]) : [],
    // who we usually write to at this firm (from the email log); falls back to the report's contact
    defaultContactIds: (r.contact.companyId && defaults.get(r.contact.companyId)?.length ? defaults.get(r.contact.companyId)! : [r.contactId]),
    openingLine: r.openingLine,
    bodyOverride: r.bodyOverride,
    draftOpen: Boolean(r.sendDraftId),
  }));

  return (
    <>
      <PageHeader
        title={`Follow ups · ${name}`}
        subtitle={`${firms.filter((f) => f.status === 2 && f.followupTo).length} firms sent and quiet · ${firms.filter((f) => f.status >= 4 || f.status === 3).length} answered, passed or already followed up (shaded; turn one on with + to include it anyway)`}
        actions={
          <>
            <SendToOne dealId={deal.id} />
            <Link href={`/deals/${deal.id}/send`} className="btn-secondary">
              Send deal
            </Link>
            <Link href={`/deals/${deal.id}`} className="btn-secondary">
              Back to deal
            </Link>
          </>
        }
      />
      <SendClient mode="followup" dealId={deal.id} firms={firms} templates={templates} defaultTemplateId={house?.id ?? ""} files={files.map((f) => ({ key: f.key, name: f.name, size: f.size, url: fileUrl(f.key) }))} saved={sendState} team={team} initialLaunch={launch && (launch.queued > 0 || launch.failed > 0 || launch.bounced > 0) ? launch : null} />
    </>
  );
}
