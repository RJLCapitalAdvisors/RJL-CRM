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
import { firstSentMessageIds, launchStatus, pumpLaunches } from "@/lib/launch-queue";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `Follow ups ${d ? d.propertyName ?? d.name : ""}` };
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a launch paces itself: one email at a time, a second or two apart

/** Send deal: pick who at each agreed firm gets it, personalize the first line, review, then drafts land in your Outlook to fire one by one. */
/** Follow ups: the Send deal page again, but every email is a reply-all on the deal email that firm was sent, and firms that answered or passed are shaded out (Jonathan, Oct 1, 2026). */
export default async function FollowUpsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  // round 1: firms sent and quiet; round 2 (the final follow-up): firms still quiet after follow-up 1 (Jonathan, Oct 8, 2026)
  const round = Math.max(1, Math.min(3, Number(Array.isArray(sp.round) ? sp.round[0] : sp.round) || 1));
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
  const launch = await launchStatus(deal.id, "FOLLOWUP").catch(() => null);
  const bouncedEmails = new Set((launch?.rows ?? []).flatMap((r) => r.bounced ?? []));
  if (launch && launch.queued > 0 && me && !process.env.CRON_SECRET) after(() => pumpLaunches(me.email, 270_000).catch(() => null)); // the minute scheduler drives sending; locally the page does
  const team = (await prisma.user.findMany({ where: { active: true, ...CA_TEAM, email: { not: null } }, select: { name: true, email: true }, orderBy: { name: "asc" } })).filter((u) => u.email && u.email.toLowerCase() !== me?.email?.toLowerCase()).map((u) => ({ name: u.name, email: u.email! }));
  const sendState = ((): SendState | null => {
    try {
      const det = JSON.parse(deal.details || "{}") as Record<string, SendState | undefined>;
      const st = det[round > 1 ? `followupState${round}` : "followupState"];
      return st && typeof st === "object" ? st : null;
    } catch {
      return null;
    }
  })();
  const defaults = new Map<string, string[]>();
  for (const r of deal.investors) {
    if (r.contact.companyId && !defaults.has(r.contact.companyId)) defaults.set(r.contact.companyId, await usualRecipients(r.contact.companyId, r.contact.company?.contacts ?? []));
  }
  const sentOn = await firstSentMessageIds(deal.id).catch(() => new Map<string, { messageId: string; sentAt: Date }>());
  const { lastFollowups } = await import("@/lib/launch-queue");
  const followups = await lastFollowups(deal.id).catch(() => new Map<string, { round: number; messageId: string | null; sentAt: Date }>());
  // a later round replies on the latest follow-up the firm got (else the deal email), so the whole thread is quoted
  const replyOn = (rowId: string) => (round > 1 && followups.get(rowId)?.messageId ? followups.get(rowId)!.messageId : sentOn.get(rowId)?.messageId ?? null);
  // the email a follow-up replies to, shown on the firm's token so there is no doubt which thread it joins (Jonathan, Oct 1, 2026)
  const sentIds = [...new Set([...sentOn.values()].map((x) => x?.messageId).filter((x): x is string => Boolean(x)))];
  const sentActs = sentIds.length ? await prisma.activity.findMany({ where: { externalId: { in: sentIds }, type: "EMAIL" }, orderBy: { occurredAt: "asc" } }) : [];
  const sentLaunches = sentIds.length ? await prisma.dealLaunch.findMany({ where: { sentMessageId: { in: sentIds } }, select: { sentMessageId: true, toContactIds: true, cc: true, mailbox: true, fileKeys: true } }) : [];
  const peopleIds = [...new Set(sentLaunches.flatMap((l) => JSON.parse(l.toContactIds) as string[]))];
  const peopleById = new Map((peopleIds.length ? await prisma.contact.findMany({ where: { id: { in: peopleIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : []).map((p) => [p.id, p]));
  const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const sentEmailFor = (rowId: string) => {
    const mid = sentOn.get(rowId)?.messageId;
    const a = mid ? sentActs.find((x) => x.externalId === mid) : null;
    if (!a) return null;
    const m = (a.meta ? JSON.parse(a.meta) : {}) as { from?: { name?: string; address: string }; to?: { name?: string; address: string }[]; cc?: { name?: string; address: string }[]; mailbox?: string; hasAttachments?: boolean };
    const who = (p?: { name?: string; address: string }) => p?.name?.trim() || p?.address || "";
    const launch = sentLaunches.find((l) => l.sentMessageId === mid);
    const toFromLaunch = launch ? (JSON.parse(launch.toContactIds) as string[]).map((id) => peopleById.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => `${[p.firstName, p.lastName].filter(Boolean).join(" ") || p.email} <${p.email}>`) : [];
    const to = (m.to ?? []).map(who).filter(Boolean);
    return { id: a.id, subject: a.subject, preview: a.body, inbound: false, date: when(a.occurredAt), from: who(m.from) || launch?.mailbox || me?.email || "", to: to.length ? to : toFromLaunch, cc: (m.cc ?? []).map(who).filter(Boolean).length ? (m.cc ?? []).map(who).filter(Boolean) : launch ? (JSON.parse(launch.cc) as string[]) : [], hasAttachments: Boolean(m.hasAttachments) || Boolean(launch?.fileKeys), externalId: a.externalId ?? null, mailbox: m.mailbox ?? launch?.mailbox ?? me?.email ?? null, contact: null, deal: null };
  };
  const firms: Firm[] = deal.investors.map((r) => ({
    rowId: r.id,
    followupTo: replyOn(r.id),
    followups: followups.get(r.id)?.round ?? 0,
    sentOn: sentOn.get(r.id)?.sentAt.toISOString() ?? null,
    sentEmail: sentEmailFor(r.id),
    status: r.status,
    company: r.contact.company?.name ?? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
    domain: r.contact.company?.domain ?? null,
    people: (r.contact.company?.contacts ?? [{ id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, email: r.contact.email, title: null }]).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "", firstName: c.firstName ?? "", email: c.email ?? "", title: c.title ?? null, bounced: Boolean(c.email && bouncedEmails.has(c.email.toLowerCase())) })),
    primaryContactId: r.contactId,
    // who we usually write to at this firm (from the email log); falls back to the report's contact
    // exactly the people the deal email went to (from the launch row, else the email log), never the firm's usual recipients
    defaultContactIds: (() => {
      const mid = sentOn.get(r.id)?.messageId;
      const launch = mid ? sentLaunches.find((l) => l.sentMessageId === mid) : null;
      const fromLaunch = launch ? (JSON.parse(launch.toContactIds) as string[]) : [];
      const fromLog = mid ? sentActs.filter((a) => a.externalId === mid && a.contactId).map((a) => a.contactId!) : [];
      const sent = fromLaunch.length ? fromLaunch : fromLog;
      return sent.length ? sent : [r.contactId];
    })(),
    extraContactIds: [],
    openingLine: r.openingLine,
    bodyOverride: r.bodyOverride,
    draftOpen: Boolean(r.sendDraftId),
  }));

  return (
    <>
      <PageHeader
        title={`${round > 1 ? `Final follow-up (round ${round})` : "Follow ups"} · ${name}`}
        subtitle={round > 1 ? `${firms.filter((f) => f.status === 3 && (f.followups ?? 0) === round - 1 && f.followupTo).length} firms still quiet after follow-up ${round - 1} · the rest are shaded (turn one on with + to include it anyway)` : `${firms.filter((f) => f.status === 2 && f.followupTo).length} firms sent and quiet · ${firms.filter((f) => f.status >= 4 || f.status === 3).length} answered, passed or already followed up (shaded; turn one on with + to include it anyway)`}
        actions={
          <>
            <Link href={`/deals/${deal.id}/followup${round > 1 ? "" : "?round=2"}`} className="btn-secondary" title={round > 1 ? "Back to the first follow-up" : "A last note to the firms still quiet after follow-up 1, as a reply all on that follow-up"}>
              {round > 1 ? "First follow-up" : "Final follow-up"}
            </Link>
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
      <SendClient mode="followup" round={round} dealId={deal.id} firms={firms} templates={templates} defaultTemplateId={house?.id ?? ""} files={files.map((f) => ({ key: f.key, name: f.name, size: f.size, url: fileUrl(f.key) }))} saved={sendState} team={team} initialLaunch={launch && (launch.queued > 0 || launch.failed > 0 || launch.bounced > 0) ? launch : null} />
    </>
  );
}
