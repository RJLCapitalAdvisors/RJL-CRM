import { prisma } from "@/lib/db";
import { mailReadsFor } from "@/lib/access";
import { houseSubjectMatches, subjectLooselyMatchesDeal, subjectMatchesDeal } from "@/lib/deal-match";
import { noteDealSent } from "@/lib/deal-outbound";
import { DEPARTURE_SUBJECT, HUMAN_DEPARTURE, noteDepartureIfAny } from "@/lib/departures";
import { emailHtmlToText } from "@/lib/attachments";
import { graph, graphConfigured, type GraphMessage } from "@/lib/graph";
import { contactForEmail, domainOf } from "@/lib/domains";
import { ACTIVE_STAGES, isBlindIntro, isLegacyIntroTicket } from "@/lib/taxonomy";

/**
 * Email log: read every team member's Sent Items and Inbox through Graph and record each email that
 * involves a known contact or company as an Activity (type EMAIL). This is what puts emails on the
 * company and contact pages, bumps lastActivityAt (so engaged firms rise in the lists), and feeds
 * criteria proposals from investor replies. Internal-only mail and unknown senders are skipped.
 */

const INTERNAL = new Set(["rjlcapadvisors.com", "rjlequities.com"]);
/**
 * People we write to become contacts, every one of them: an email we send to people the CRM does not know creates
 * each of them (and their company from the domain, which then reads its own website); on a reply thread with us,
 * the sender and everyone copied. A stranger's first email does not: newsletters, listings blasts and notifications
 * stay out. The person whose mailbox it is owns the contacts and companies made from it.
 */
const MAILER = /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|notify|mailer-daemon|postmaster|bounces?|newsletters?|marketing|news|updates?|digest|hello|team|community|alerts?|calendar-notification|invitations?|receipts?|billing|security|account|welcome|feedback|survey|promo|offers?|unsubscribe|reply|\d+)[@._+-]/i;
const BULK_HOSTS = ["bcc.hubspot.com", "hubspot.com", "hubspotemail.net", "instagram.com", "facebookmail.com", "linkedin.com", "google.com", "microsoft.com", "microsoftonline.com", "office.com", "apple.com", "amazon.com", "amazonses.com", "paypal.com", "stripe.com", "zoom.us", "calendly.com", "docusign.net", "docusign.com", "dropbox.com", "dropboxmail.com", "mailchimp.com", "mcsv.net", "sendgrid.net", "constantcontact.com", "substack.com", "fireflies.ai", "otter.ai", "slack.com", "atlassian.com", "github.com", "vercel.com", "resend.com", "anthropic.com"];
const isSystemAddress = (a: string) => {
  const d = a.toLowerCase().split("@")[1] ?? "";
  return MAILER.test(a.toLowerCase()) || BULK_HOSTS.some((h) => d === h || d.endsWith("." + h));
};
const REPLY = /^\s*(re|fwd?|fw)\s*:/i;
const FIRST_SYNC_DAYS = 120;
const PAGE = 50;

type Party = { name?: string; address: string };
type Msg = GraphMessage & { internetMessageId?: string; bodyPreview?: string; ccRecipients?: { emailAddress: Party }[]; hasAttachments?: boolean };

/** Worth a departure check: an auto-reply or bounce subject, or a preview that reads like "no longer with the firm" (a colleague answering a blast). */
const departureHint = (m: Msg) => DEPARTURE_SUBJECT.test((m.subject ?? "").trim()) || HUMAN_DEPARTURE.test(m.bodyPreview ?? "");
/** The whole message, not the 255-character preview: what the sender wrote above the quoted thread, up to 6,000 characters. Used for departures and for every inbound email kept on the log. */
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

/**
 * Everyone on an email who is not us. Every external person becomes (or already is) a contact when the email is a
 * conversation: one we sent to up to ten outside people, or a reply thread with us on it. The first of them is the
 * Activity's contact; the rest are its parties, so the email shows on each person's page and their company's
 * page. A stranger's first email creates nobody (newsletters, blasts, notifications stay out). New contacts and
 * companies belong to the person whose mailbox this is. Before Sep 15, 2026 only one person per email was ever
 * created, and none when any recipient or their company was already known; that is why the second person at a
 * firm and everyone on CC went missing.
 */
type Resolved = { contactId: string | null; companyId: string | null; parties: { contactId: string; companyId: string | null; role: string }[]; created: number };
export async function resolveParticipants(subject: string | null | undefined, outbound: boolean, from: Party | undefined, to: Party[], cc: Party[], ownerId: string | null): Promise<Resolved> {
  const everyone = [from, ...to, ...cc].filter((p): p is Party => Boolean(p?.address));
  const external = everyone.filter((p) => !isInternal(p.address));
  const conversation = outbound ? external.length <= 10 : REPLY.test(subject ?? "") && [...to, ...cc].some((p) => isInternal(p.address));
  const roleOf = (p: Party) => (p === from ? "from" : to.includes(p) ? "to" : "cc");
  const ordered = outbound ? external : [...(from && !isInternal(from.address) ? [from] : []), ...external.filter((p) => p !== from)];
  const seen = new Set<string>();
  const found: Resolved["parties"] = [];
  let created = 0;
  for (const p of ordered) {
    const addr = p.address.toLowerCase();
    if (seen.has(addr)) continue;
    seen.add(addr);
    let c: { id: string; companyId: string | null; ownerId?: string | null } | null = await prisma.contact.findUnique({ where: { email: addr }, select: { id: true, companyId: true, ownerId: true } });
    if (c) {
      await fillContactName(c.id, p.name);
      if (ownerId && !c.ownerId) await prisma.contact.update({ where: { id: c.id }, data: { ownerId } }).catch(() => null);
    } else if (conversation && !isSystemAddress(addr)) {
      const made = await contactForEmail(addr, { name: p.name && !p.name.includes("@") ? p.name : null, ownerId }).catch(() => null);
      if (made) {
        c = { id: made.id, companyId: made.companyId };
        created++;
      }
    }
    if (c) found.push({ contactId: c.id, companyId: c.companyId, role: roleOf(p) });
  }
  const primary = found[0] ?? null;
  let companyId = primary?.companyId ?? null;
  if (!primary) {
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
  return { contactId: primary?.contactId ?? null, companyId, parties: found.slice(1), created };
}

/** The other people on a logged email: rows for each, and Last activity moves for them and their companies. */
export async function attachParties(activityId: string, parties: Resolved["parties"], when: Date) {
  if (!parties.length) return;
  await prisma.activityParty.createMany({ data: parties.map((x) => ({ activityId, contactId: x.contactId, companyId: x.companyId, role: x.role })), skipDuplicates: true });
  for (const x of parties) await bumpLastActivity(x.contactId, x.companyId, when);
}

export async function dealResolver() {
  // legacy HubSpot intro records are not tickets: an email is never filed on one
  const activeDeals = (await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, propertyName: true, sponsorName: true, city: true, state: true, assetClass: true, strategy: true, requestedAmount: true, executionType: true, requestType: true, sponsorCompanyId: true, hubspotId: true, stage: true, parentDealId: true, propertyAddress: true, sponsorCompany: { select: { roles: true } }, investors: { select: { contactId: true } }, _count: { select: { files: true, facts: true } } } })).filter((d) => !isLegacyIntroTicket({ ...d, sponsorRoles: d.sponsorCompany?.roles ?? null, investorCount: d.investors.length }) && !isBlindIntro({ ...d, fileCount: d._count.files, factCount: d._count.facts }));
  // an email about one property of a portfolio belongs to the portfolio
  const up = (id: string | undefined) => (id ? (activeDeals.find((d) => d.id === id)?.parentDealId ?? id) : id);
  const dealFor = (subject: string, contactId: string | null = null, companyId: string | null = null) =>
    up(
      activeDeals.find((d) => subjectMatchesDeal(subject, d))?.id ??
        activeDeals.find((d) => houseSubjectMatches(subject, d))?.id ??
        activeDeals.find((d) => ((contactId && d.investors.some((r) => r.contactId === contactId)) || (companyId && d.sponsorCompanyId === companyId)) && subjectLooselyMatchesDeal(subject, d))?.id,
    );
  return dealFor;
}

export async function syncMailbox(mailbox: string, opts: { sinceDays?: number } = {}): Promise<{ scanned: number; logged: number; created: number }> {
  const user = await prisma.user.findFirst({ where: { email: { equals: mailbox, mode: "insensitive" } } });
  // Sent Items show up in Graph a little after the send. A window that starts exactly where the last pass ended
  // misses an email sent during that pass, forever. Overlap the window; the Message-ID check keeps it from logging twice.
  const OVERLAP_MS = 90 * 60_000;
  const since = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86_400_000) : user?.mailSyncedAt ? new Date(user.mailSyncedAt.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  let created = 0;
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

    const r = await resolveParticipants(m.subject, outbound, from, to, cc, user?.id ?? null);
    created += r.created;
    if (!r.contactId && !r.companyId) {
      // a bounce or auto-reply from a mail system about someone we know: "so-and-so is no longer with the firm"
      if (!outbound && departureHint(m)) await noteDepartureIfAny({ subject: m.subject ?? null, text: await departureText(mailbox, m), fromAddress: from?.address ?? null, contactId: null, messageId: m.internetMessageId ?? null }).catch(() => 0);
      continue; // nobody we track
    }
    const contactId = r.contactId, companyId = r.companyId;
    if (!outbound && departureHint(m)) await noteDepartureIfAny({ subject: m.subject ?? null, text: await departureText(mailbox, m), fromAddress: from?.address ?? null, contactId, messageId: m.internetMessageId ?? null }).catch(() => 0);

    const when = new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now());
    const sentDeal = dealFor(m.subject ?? "", contactId, companyId);
    const act = await prisma.activity.create({
      data: {
        type: "EMAIL",
        direction: outbound ? "OUTBOUND" : "INBOUND",
        subject: m.subject ?? "(no subject)",
        // an investor's reply is kept whole (the part they wrote, up to 6,000 characters), not Graph's 255-character preview, so the
        // report and the LP ask scan read what they said (EVCap's pass on Galleria Trace was cut off mid-sentence, Sep 22, 2026)
        body: outbound ? m.bodyPreview ?? null : await departureText(mailbox, m),
        occurredAt: when,
        externalId: ext,
        contactId,
        companyId,
        dealId: sentDeal ?? null,
        meta: JSON.stringify({ from, to, cc, mailbox, hasAttachments: m.hasAttachments ?? false }),
      },
    });
    if (outbound && sentDeal) await noteDealSent({ dealId: sentDeal, contactId, companyId, mailbox, graphId: m.id, hasAttachments: m.hasAttachments ?? false, when, toEmails: to.map((p) => p.address) }).catch(() => false);
    await bumpLastActivity(contactId, companyId, when);
    await attachParties(act.id, r.parties, when);
    logged++;
  }
  if (user) await prisma.user.update({ where: { id: user.id }, data: { mailSyncedAt: startedAt } });
  return { scanned: messages.length, logged, created };
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
  const owner = await prisma.user.findFirst({ where: { email: { equals: mailbox, mode: "insensitive" } }, select: { id: true } });
  let logged = 0;
  for (const msg of msgs) {
    const ext = msg.internetMessageId ?? msg.id;
    if (await prisma.activity.findUnique({ where: { externalId: ext }, select: { id: true } })) continue;
    const to = (msg.toRecipients ?? []).map((r) => r.emailAddress);
    const cc = (msg.ccRecipients ?? []).map((r) => r.emailAddress);
    const external = [...to, ...cc].filter((p) => p?.address && !isInternal(p.address));
    if (!external.length) continue;
    const r = await resolveParticipants(msg.subject, true, msg.from?.emailAddress, to, cc, owner?.id ?? null);
    if (!r.contactId) continue;
    const contactId = r.contactId, companyId = r.companyId;
    const when = new Date(msg.sentDateTime ?? msg.receivedDateTime ?? Date.now());
    const sentDeal = dealFor(msg.subject ?? "", contactId, companyId);
    const act = await prisma.activity.create({ data: { type: "EMAIL", direction: "OUTBOUND", subject: msg.subject ?? "(no subject)", body: msg.bodyPreview ?? null, occurredAt: when, externalId: ext, contactId, companyId, dealId: sentDeal ?? null, meta: JSON.stringify({ from: msg.from?.emailAddress, to, cc, mailbox, hasAttachments: msg.hasAttachments ?? false }) } }).catch(() => null);
    if (sentDeal) await noteDealSent({ dealId: sentDeal, contactId, companyId, mailbox, graphId: msg.id, hasAttachments: msg.hasAttachments ?? false, when, toEmails: to.map((p) => p.address) }).catch(() => false);
    await bumpLastActivity(contactId, companyId, when); // this pass used to log without bumping, so Last activity lagged the email log
    if (act) await attachParties(act.id, r.parties, when);
    logged++;
  }
  return logged;
}

/** Last activity on the contact and its company moves forward to this email (never backwards). Every path that logs an email calls this. */
export async function bumpLastActivity(contactId: string | null, companyId: string | null, when: Date) {
  await Promise.all([
    contactId ? prisma.contact.updateMany({ where: { id: contactId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null,
    companyId ? prisma.company.updateMany({ where: { id: companyId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null,
  ]);
}

/** Every active team mailbox. Skips quietly when Microsoft is not configured. */
export async function syncAllMailboxes(opts: { sinceDays?: number } = {}): Promise<Record<string, { scanned: number; logged: number; created: number } | string>> {
  if (!graphConfigured()) return {};
  // RJL Capital Advisors mailboxes only, and only those whose Email reading (Settings > Users) points here: an
  // @rjlisrael.com or partner address is RJL Israel's business, an RJL Acquisitions person's mailbox (Shawn) feeds that log
  const users = (await prisma.user.findMany({ where: { active: true, email: { not: null } } })).filter((u) => mailReadsFor(u).includes("CA"));
  const out: Record<string, { scanned: number; logged: number; created: number } | string> = {};
  for (const u of users) {
    try {
      out[u.email!] = await syncMailbox(u.email!, opts);
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
    const { detectIntroCalls } = await import("@/lib/intro-calls");
    await detectIntroCalls().catch(() => ({})); // a recorded or calendared call with a group moves its row to Intro Made
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