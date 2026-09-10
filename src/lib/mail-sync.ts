import { prisma } from "@/lib/db";
import { houseSubjectMatches, subjectLooselyMatchesDeal, subjectMatchesDeal } from "@/lib/deal-match";
import { noteDealSent } from "@/lib/deal-outbound";
import { DEPARTURE_SUBJECT, HUMAN_DEPARTURE, noteDepartureIfAny } from "@/lib/departures";
import { emailHtmlToText } from "@/lib/attachments";
import { graph, graphConfigured, type GraphMessage } from "@/lib/graph";
import { domainOf } from "@/lib/domains";
import { ACTIVE_STAGES, isLegacyIntroTicket } from "@/lib/taxonomy";

/**
 * Email log: read every team member's Sent Items and Inbox through Graph and record each email that
 * involves a known contact or company as an Activity (type EMAIL). This is what puts emails on the
 * company and contact pages, bumps lastActivityAt (so engaged firms rise in the lists), and feeds
 * criteria proposals from investor replies. Internal-only mail and unknown senders are skipped.
 */

const INTERNAL = new Set(["rjlcapadvisors.com", "rjlequities.com"]);
const FIRST_SYNC_DAYS = 120;
const PAGE = 50;

type Party = { name?: string; address: string };
type Msg = GraphMessage & { internetMessageId?: string; bodyPreview?: string; ccRecipients?: { emailAddress: Party }[]; hasAttachments?: boolean };

/** Worth a departure check: an auto-reply or bounce subject, or a preview that reads like "no longer with the firm" (a colleague answering a blast). */
const departureHint = (m: Msg) => DEPARTURE_SUBJECT.test((m.subject ?? "").trim()) || HUMAN_DEPARTURE.test(m.bodyPreview ?? "");
/** The whole message, not the 255-character preview: the replacement's name and email are usually a line or two down. */
async function departureText(mailbox: string, m: Msg): Promise<string> {
  try {
    const full = await graph<{ body?: { contentType: string; content: string } }>(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(m.id)}?$select=body`);
    const c = full.body?.content ?? "";
    const text = full.body?.contentType?.toLowerCase() === "html" ? emailHtmlToText(c) : c;
    // the quoted original below the reply would name the very people we wrote to; keep what the replier wrote
    return (text.split(/\n\s*(?:From:|-----Original Message-----|On .{5,80} wrote:)/i)[0] || text).slice(0, 6000) || m.bodyPreview || "";
  } catch {
    return m.bodyPreview ?? "";
  }
}

const q = (s: string) => encodeURIComponent(s);
const isInternal = (addr: string) => INTERNAL.has(addr.toLowerCase().split("@")[1] ?? "");

async function pageThrough(mailbox: string, folder: "sentitems" | "inbox", since: Date): Promise<Msg[]> {
  const out: Msg[] = [];
  let url: string | null = `/users/${q(mailbox)}/mailFolders/${folder}/messages?$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime desc&$top=${PAGE}&$select=id,internetMessageId,subject,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,hasAttachments,isDraft`;
  while (url && out.length < 2000) {
    const r: { value: Msg[]; "@odata.nextLink"?: string } = await graph(url);
    out.push(...r.value.filter((m) => !m.isDraft));
    url = r["@odata.nextLink"] ?? null;
  }
  return out;
}

/** The deal an email is about: its name in the subject; else, for someone on a deal's report or at its sponsor, the city or a property word. */
/** A contact imported without a name gets it from the display name on the first email we see them on. */
async function fillContactName(contactId: string, displayName: string | undefined) {
  if (!displayName || displayName.includes("@")) return;
  let n = displayName.replace(/^["']|["']$/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (n.includes(",")) {
    const [l, f] = n.split(",").map((x) => x.trim());
    n = `${f} ${l}`;
  }
  const parts = n.split(/\s+/).filter((x) => x && !/^(mr|mrs|ms|dr)\.?$/i.test(x));
  if (!parts.length || parts.length > 4) return;
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
  if (!c || (c.firstName && c.firstName.trim())) return;
  await prisma.contact.update({ where: { id: contactId }, data: { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : c.lastName } }).catch(() => null);
}

export async function dealResolver() {
  // legacy HubSpot intro records are not tickets: an email is never filed on one
  const activeDeals = (await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, propertyName: true, sponsorName: true, city: true, state: true, assetClass: true, strategy: true, requestedAmount: true, executionType: true, requestType: true, sponsorCompanyId: true, hubspotId: true, stage: true, sponsorCompany: { select: { roles: true } }, investors: { select: { contactId: true } } } })).filter((d) => !isLegacyIntroTicket({ ...d, sponsorRoles: d.sponsorCompany?.roles ?? null, investorCount: d.investors.length }));
  const dealFor = (subject: string, contactId: string | null = null, companyId: string | null = null) =>
    activeDeals.find((d) => subjectMatchesDeal(subject, d))?.id ??
    activeDeals.find((d) => houseSubjectMatches(subject, d))?.id ??
    activeDeals.find((d) => ((contactId && d.investors.some((r) => r.contactId === contactId)) || (companyId && d.sponsorCompanyId === companyId)) && subjectLooselyMatchesDeal(subject, d))?.id;
  return dealFor;
}

export async function syncMailbox(mailbox: string): Promise<{ scanned: number; logged: number }> {
  const user = await prisma.user.findFirst({ where: { email: { equals: mailbox, mode: "insensitive" } } });
  // Sent Items show up in Graph a little after the send. A window that starts exactly where the last pass ended
  // misses an email sent during that pass, forever. Overlap the window; the Message-ID check keeps it from logging twice.
  const OVERLAP_MS = 90 * 60_000;
  const since = user?.mailSyncedAt ? new Date(user.mailSyncedAt.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  const startedAt = new Date();
  const [sent, inbox] = await Promise.all([pageThrough(mailbox, "sentitems", since), pageThrough(mailbox, "inbox", since)]);
  const messages = [...sent, ...inbox];

  const dealFor = await dealResolver();

  let logged = 0;
  for (const m of messages) {
    const ext = m.internetMessageId ?? m.id;
    if (await prisma.activity.findUnique({ where: { externalId: ext }, select: { id: true } })) continue;
    const from = m.from?.emailAddress;
    const to = (m.toRecipients ?? []).map((r) => r.emailAddress);
    const cc = (m.ccRecipients ?? []).map((r) => r.emailAddress);
    const everyone = [from, ...to, ...cc].filter((p): p is Party => Boolean(p?.address));
    const external = everyone.filter((p) => !isInternal(p.address));
    if (!external.length) continue; // internal chatter
    const outbound = from ? isInternal(from.address) : false;

    // who is this about: the first external address we know (prefer the sender on inbound, the recipients on outbound)
    const ordered = outbound ? external : [from!, ...external.filter((p) => p !== from)];
    let contactId: string | null = null;
    let companyId: string | null = null;
    for (const p of ordered) {
      const c = await prisma.contact.findUnique({ where: { email: p.address.toLowerCase() }, select: { id: true, companyId: true } });
      if (c) {
        contactId = c.id;
        companyId = c.companyId;
        await fillContactName(c.id, p.name);
        break;
      }
    }
    if (!contactId) {
      for (const p of ordered) {
        const d = domainOf(p.address);
        if (!d) continue;
        const co = await prisma.company.findFirst({ where: { domain: d }, select: { id: true } });
        if (co) {
          companyId = co.id;
          break;
        }
      }
    }
    if (!contactId && !companyId) {
      // a bounce or auto-reply from a mail system about someone we know: "so-and-so is no longer with the firm"
      if (!outbound && departureHint(m)) await noteDepartureIfAny({ subject: m.subject ?? null, text: await departureText(mailbox, m), fromAddress: from?.address ?? null, contactId: null, messageId: m.internetMessageId ?? null }).catch(() => 0);
      continue; // nobody we track
    }
    if (!outbound && departureHint(m)) await noteDepartureIfAny({ subject: m.subject ?? null, text: await departureText(mailbox, m), fromAddress: from?.address ?? null, contactId, messageId: m.internetMessageId ?? null }).catch(() => 0);

    const when = new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now());
    const sentDeal = dealFor(m.subject ?? "", contactId, companyId);
    await prisma.activity.create({
      data: {
        type: "EMAIL",
        direction: outbound ? "OUTBOUND" : "INBOUND",
        subject: m.subject ?? "(no subject)",
        body: m.bodyPreview ?? null,
        occurredAt: when,
        externalId: ext,
        contactId,
        companyId,
        dealId: sentDeal ?? null,
        meta: JSON.stringify({ from, to, cc, mailbox, hasAttachments: m.hasAttachments ?? false }),
      },
    });
    if (outbound && sentDeal) await noteDealSent({ dealId: sentDeal, contactId, companyId, mailbox, graphId: m.id, hasAttachments: m.hasAttachments ?? false, when, toEmails: to.map((p) => p.address) }).catch(() => false);
    const bump = [contactId ? prisma.contact.updateMany({ where: { id: contactId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null, companyId ? prisma.company.updateMany({ where: { id: companyId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null];
    await Promise.all(bump);
    logged++;
  }
  if (user) await prisma.user.update({ where: { id: user.id }, data: { mailSyncedAt: startedAt } });
  return { scanned: messages.length, logged };
}

/**
 * Quick pass for the dashboard: only this person's Sent Items from the last few hours, so a follow-up they
 * just sent is recognized on the very next page load instead of the next full sync.
 */
export async function syncRecentSent(mailbox: string, hours = 6): Promise<number> {
  if (!graphConfigured()) return 0;
  const since = new Date(Date.now() - hours * 3600_000);
  const msgs = await pageThrough(mailbox, "sentitems", since).catch(() => [] as Msg[]);
  const dealFor = await dealResolver();
  let logged = 0;
  for (const msg of msgs) {
    const ext = msg.internetMessageId ?? msg.id;
    if (await prisma.activity.findUnique({ where: { externalId: ext }, select: { id: true } })) continue;
    const to = (msg.toRecipients ?? []).map((r) => r.emailAddress);
    const cc = (msg.ccRecipients ?? []).map((r) => r.emailAddress);
    const external = [...to, ...cc].filter((p) => p?.address && !isInternal(p.address));
    if (!external.length) continue;
    let contactId: string | null = null, companyId: string | null = null;
    for (const p of external) {
      const c = await prisma.contact.findUnique({ where: { email: p.address.toLowerCase() }, select: { id: true, companyId: true } });
      if (c) { contactId = c.id; companyId = c.companyId; await fillContactName(c.id, p.name); break; }
    }
    if (!contactId) continue;
    const when = new Date(msg.sentDateTime ?? msg.receivedDateTime ?? Date.now());
    const sentDeal = dealFor(msg.subject ?? "", contactId, companyId);
    await prisma.activity.create({ data: { type: "EMAIL", direction: "OUTBOUND", subject: msg.subject ?? "(no subject)", body: msg.bodyPreview ?? null, occurredAt: when, externalId: ext, contactId, companyId, dealId: sentDeal ?? null, meta: JSON.stringify({ from: msg.from?.emailAddress, to, cc, mailbox, hasAttachments: msg.hasAttachments ?? false }) } }).catch(() => null);
    if (sentDeal) await noteDealSent({ dealId: sentDeal, contactId, companyId, mailbox, graphId: msg.id, hasAttachments: msg.hasAttachments ?? false, when, toEmails: to.map((p) => p.address) }).catch(() => false);
    logged++;
  }
  return logged;
}

/** Every active team mailbox. Skips quietly when Microsoft is not configured. */
export async function syncAllMailboxes(): Promise<Record<string, { scanned: number; logged: number } | string>> {
  if (!graphConfigured()) return {};
  const users = await prisma.user.findMany({ where: { active: true, email: { not: null } } });
  const out: Record<string, { scanned: number; logged: number } | string> = {};
  for (const u of users) {
    try {
      out[u.email!] = await syncMailbox(u.email!);
    } catch (e) {
      out[u.email!] = String(e instanceof Error ? e.message : e).slice(0, 160);
    }
  }
  return out;
}

/** Called from page loads: refresh the log in the background if it has been a while. */
let lastKick = 0;
export function kickMailSync(minMinutes = 3) {
  if (!graphConfigured() || Date.now() - lastKick < minMinutes * 60_000) return;
  lastKick = Date.now();
  const run = async () => {
    await syncAllMailboxes().catch(() => ({}));
    const { processDealsInbox } = await import("@/lib/deals-inbox");
    await processDealsInbox().catch(() => ({}));
    const { refreshMomentum } = await import("@/lib/momentum");
    await refreshMomentum().catch(() => ({}));
    const { syncEngagementDrafts } = await import("@/lib/engagement");
    await syncEngagementDrafts().catch(() => 0);
    const { syncSendDrafts } = await import("@/lib/send-deal");
    await syncSendDrafts().catch(() => 0);
    const { pumpAllLaunches } = await import("@/lib/launch-queue");
    await pumpAllLaunches().catch(() => 0); // a launch left running when the Send deal page was closed
    const { scanAllIntros } = await import("@/lib/intros");
    await scanAllIntros().catch(() => ({}));
  };
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => void run());
}


/**
 * Emails logged without a deal (imported history, or mail that arrived before the ticket existed) are tied to
 * the deal their subject names. Runs from the cron; cheap because each email is looked at once (it gains a dealId
 * or keeps failing the match).
 */
export async function linkStrayEmails(days = 90): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const acts = await prisma.activity.findMany({ where: { type: "EMAIL", dealId: null, occurredAt: { gte: since }, subject: { not: null } }, select: { id: true, subject: true, contactId: true, companyId: true }, take: 2000 });
  if (!acts.length) return 0;
  const dealFor = await dealResolver();
  let linked = 0;
  for (const a of acts) {
    const id = dealFor(a.subject ?? "", a.contactId, a.companyId);
    if (!id) continue;
    await prisma.activity.update({ where: { id: a.id }, data: { dealId: id } });
    linked++;
  }
  return linked;
}