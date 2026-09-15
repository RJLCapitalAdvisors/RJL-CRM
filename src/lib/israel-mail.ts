import { prisma } from "@/lib/db";
import { isIlMailbox } from "@/lib/access";
import { graph, graphConfigured, israelGraphConfigured, type GraphMessage } from "@/lib/graph";
import { FREE_MAIL, nameFromDomain } from "@/lib/domains";
import { ISRAEL_MAILBOX } from "@/lib/israel-intake";
import { mergeIlRoles } from "@/lib/israel";

/**
 * RJL Israel email log. The same job the RJL Capital Advisors sync does, for the other business: every RJL Israel
 * mailbox (each person's @rjlisrael.com address from Settings, plus deals@) is read through Graph, and each email
 * with someone outside the company becomes an IlActivity on that person's contact record and their company.
 * Unlike the US side, people are not pre-imported here, so a new correspondent is created as a contact on the
 * spot, and a company is created from their email domain (never from Gmail, Walla and the like). Internal-only
 * mail, mailers and bounces are skipped. Runs from the daily cron, from RJL Israel page loads (throttled) and
 * from the Graph notification for deals@.
 */

const INTERNAL = new Set(["rjlisrael.com", "rjlcapadvisors.com", "rjlequities.com", (process.env.ISRAEL_DEALS_MAILBOX ?? "").split("@")[1]?.toLowerCase() ?? "rjlisrael.com"]);
const IL_FREE_MAIL = new Set([...FREE_MAIL, "walla.co.il", "walla.com", "bezeqint.net", "012.net.il", "013.net", "013net.net", "netvision.net.il", "smile.net.il", "zahav.net.il", "017.net.il", "nana.co.il", "nana10.co.il", "hotmail.co.il", "yahoo.co.il", "outlook.co.il", "live.co.il"]);
// senders that are systems, not people: notifications, newsletters, receipts, marketing
const MAILER = /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|notify|mailer-daemon|postmaster|bounces?|newsletters?|marketing|news|updates?|digest|hello|team|community|alerts?|calendar-notification|invitations?|receipts?|billing|security|account|welcome|feedback|survey|promo|offers?|unsubscribe|reply)[@._+-]/i;
// domains that only ever send automated mail
const BULK_LIST = ["instagram.com", "facebookmail.com", "facebook.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com", "google.com", "googlemail.com", "microsoft.com", "microsoftonline.com", "office.com", "office365.com", "apple.com", "amazon.com", "amazonses.com", "paypal.com", "stripe.com", "zoom.us", "calendly.com", "docusign.net", "docusign.com", "dropbox.com", "dropboxmail.com", "hubspot.com", "hubspotemail.net", "mailchimp.com", "mailchimpapp.net", "mcsv.net", "sendgrid.net", "constantcontact.com", "substack.com", "beehiiv.com", "medium.com", "wix.com", "godaddy.com", "whatsapp.com", "waze.com", "uber.com", "yad2.co.il", "madlan.co.il", "homeless.co.il", "gov.il", "bezeq.co.il", "cellcom.co.il", "partner.co.il", "hot.net.il", "leumi.co.il", "bankhapoalim.co.il", "discountbank.co.il", "mizrahi-tefahot.co.il", "isracard.co.il", "cal-online.co.il", "max.co.il", "pango.co.il", "10bis.co.il", "wolt.com", "shufersal.co.il", "elal.co.il", "elal.com", "booking.com", "airbnb.com", "expedia.com", "fireflies.ai", "otter.ai", "notion.so", "slack.com", "atlassian.com", "github.com", "vercel.com", "anthropic.com", "openai.com"];
const isBulkDomain = (d: string) => BULK_LIST.some((b) => d === b || d.endsWith("." + b));
const FIRST_SYNC_DAYS = 120;
const PAGE = 50;
const q = (s: string) => encodeURIComponent(s);

type Party = { name?: string; address: string };
type Msg = GraphMessage & { bodyPreview?: string; ccRecipients?: { emailAddress: Party }[]; inferenceClassification?: "focused" | "other"; replyTo?: { emailAddress: Party }[] };
/** Bulk mail by its shape: Outlook filed it under Other, or it carries a marketing subject, or the sender's display name is a brand line. */
const BULK_WORDS = /\b(unsubscribe|newsletter|weekly (highlights|update|digest)|performance update|webinar|you're invited|% off|sale ends|limited time|new listings? (this|for you)|your (order|receipt|invoice|statement|password|verification code)|verify your|confirm your|sign[- ]?in attempt|security alert)\b/i;
const looksBulk = (m: Msg) => m.inferenceClassification === "other" || BULK_WORDS.test(`${m.subject ?? ""} ${m.bodyPreview ?? ""}`);

const domainOf = (a: string) => a.toLowerCase().split("@")[1] ?? "";
const isInternal = (a: string) => INTERNAL.has(domainOf(a));
const isMailer = (a: string) => MAILER.test(a.toLowerCase()) || isBulkDomain(domainOf(a));
/** "mail.instagram.com" -> "instagram.com"; "x.co.il" keeps its three labels. */
const rootDomain = (d: string) => {
  const parts = d.split(".");
  const two = /^(co|org|net|ac|gov|muni|k12)$/.test(parts[parts.length - 2] ?? "") && parts.length > 2 ? 3 : 2;
  return parts.slice(-two).join(".");
};

/** The mailboxes that belong to RJL Israel: each person's registered Israel address and the deals mailbox. */
export async function israelMailboxes(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { active: true, israelEmail: { not: null } }, select: { israelEmail: true } });
  // @rjlisrael.com mailboxes only (partner mailboxes live in another tenant; RJL CA addresses belong to the other log)
  const boxes = [...users.map((u) => u.israelEmail!.toLowerCase()), ISRAEL_MAILBOX().toLowerCase()].filter(isIlMailbox);
  return boxes.filter((b, i) => boxes.indexOf(b) === i);
}

/** Whether the Israel mailboxes can be read at all: the Israel tenant's app, or the main tenant when it hosts rjlisrael.com. */
export const israelMailConfigured = () => israelGraphConfigured() || graphConfigured();

async function pageThrough(mailbox: string, folder: "sentitems" | "inbox", since: Date): Promise<Msg[]> {
  const out: Msg[] = [];
  let url: string | null = `/users/${q(mailbox)}/mailFolders/${folder}/messages?$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime desc&$top=${PAGE}&$select=id,internetMessageId,subject,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,hasAttachments,isDraft,inferenceClassification`;
  while (url && out.length < 2000) {
    const r: { value: Msg[]; "@odata.nextLink"?: string } = await graph(url);
    out.push(...r.value.filter((m) => !m.isDraft));
    url = r["@odata.nextLink"] ?? null;
  }
  return out;
}

const splitName = (display: string | undefined, address: string): { firstName: string | null; lastName: string | null } => {
  let n = (display ?? "").replace(/^["']|["']$/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!n || n.includes("@")) {
    // "yael.tzur" or "yael_tzur" from the address; a bare handle stays the first name
    n = address.split("@")[0].split(/[._-]/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "")).join(" ").trim();
  }
  if (n.includes(",")) {
    const [l, f] = n.split(",").map((x) => x.trim());
    n = `${f} ${l}`;
  }
  const parts = n.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
};

/** The company behind an email domain, created on first sight and named after the domain. Free-mail addresses have none. */
async function companyForDomain(domain: string): Promise<string | null> {
  if (!domain || IL_FREE_MAIL.has(domain)) return null;
  domain = rootDomain(domain);
  if (IL_FREE_MAIL.has(domain)) return null;
  const existing = (await prisma.ilCompany.findFirst({ where: { domain }, select: { id: true } })) ?? (await prisma.ilCompany.findFirst({ where: { website: { contains: domain, mode: "insensitive" } }, select: { id: true } }));
  if (existing) {
    await prisma.ilCompany.updateMany({ where: { id: existing.id, domain: null }, data: { domain } });
    return existing.id;
  }
  const co = await prisma.ilCompany.create({ data: { name: nameFromDomain(domain), domain, website: `https://${domain}` }, select: { id: true } });
  return co.id;
}

/** The contact for an outside correspondent, created from the email when unknown. */
async function contactFor(p: Party): Promise<{ id: string; companyId: string | null }> {
  const email = p.address.toLowerCase();
  const found = await prisma.ilContact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, companyId: true, firstName: true, lastName: true } });
  const companyId = await companyForDomain(domainOf(email));
  if (found) {
    const data: { companyId?: string; firstName?: string | null; lastName?: string | null; roles?: string } = {};
    if (!found.companyId && companyId) {
      data.companyId = companyId;
      const co = await prisma.ilCompany.findUnique({ where: { id: companyId }, select: { roles: true } });
      if (co) Object.assign(data, { roles: mergeIlRoles(await prisma.ilContact.findUnique({ where: { id: found.id }, select: { roles: true } }).then((x) => x?.roles), co.roles) });
    }
    if (!found.firstName && !found.lastName && p.name && !p.name.includes("@")) Object.assign(data, splitName(p.name, email));
    if (Object.keys(data).length) await prisma.ilContact.update({ where: { id: found.id }, data }).catch(() => null);
    return { id: found.id, companyId: found.companyId ?? companyId };
  }
  const co = companyId ? await prisma.ilCompany.findUnique({ where: { id: companyId }, select: { roles: true } }) : null;
  const c = await prisma.ilContact.create({ data: { ...splitName(p.name, email), email, companyId, roles: co?.roles ?? "[]" }, select: { id: true } });
  return { id: c.id, companyId };
}

/** The one live deal this person is on, if there is exactly one, so the email lands on the deal too. */
async function dealFor(contactId: string): Promise<string | null> {
  const deals = await prisma.ilDeal.findMany({ where: { closedAt: null, OR: [{ buyerContactId: contactId }, { agentContactId: contactId }] }, select: { id: true }, take: 2 });
  return deals.length === 1 ? deals[0].id : null;
}

export async function syncIsraelMailbox(mailbox: string): Promise<{ scanned: number; logged: number }> {
  const user = await prisma.user.findFirst({ where: { israelEmail: { equals: mailbox, mode: "insensitive" } } });
  const OVERLAP_MS = 90 * 60_000;
  const last = user ? user.israelMailSyncedAt : (await prisma.ilSyncState.findUnique({ where: { mailbox: mailbox.toLowerCase() } }))?.syncedAt ?? null;
  const since = last ? new Date(last.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  const startedAt = new Date();
  const [sent, inbox] = await Promise.all([pageThrough(mailbox, "sentitems", since), pageThrough(mailbox, "inbox", since)]);
  // Sent Items first: the people we write to are the ones who become contacts. An inbound email from someone we
  // never wrote to is logged only when it is a reply to us; a first email from a stranger (marketing, listings
  // blasts, event invitations) waits until we answer it.
  const messages = [...sent, ...inbox];

  let logged = 0;
  for (const m of messages) {
    const ext = m.internetMessageId ?? m.id;
    if (await prisma.ilActivity.findUnique({ where: { externalId: ext }, select: { id: true } })) continue;
    const from = m.from?.emailAddress;
    const to = (m.toRecipients ?? []).map((r) => r.emailAddress);
    const cc = (m.ccRecipients ?? []).map((r) => r.emailAddress);
    const everyone = [from, ...to, ...cc].filter((p): p is Party => Boolean(p?.address));
    const external = everyone.filter((p) => !isInternal(p.address) && !isMailer(p.address));
    if (!external.length) continue; // internal chatter, or a mailer
    const outbound = from ? isInternal(from.address) : false;
    if (!outbound && from && isMailer(from.address)) continue; // notifications and bounces are not people
    if (!outbound && looksBulk(m)) continue; // newsletters and marketing are not conversations
    // an inbound email that was not addressed to this mailbox (a list, a bcc blast) is not a conversation either
    if (!outbound && ![...to, ...cc].some((p) => p.address.toLowerCase() === mailbox.toLowerCase() || isInternal(p.address))) continue;

    // the person this email is about: the sender when it came in, the first outside recipient when we wrote it
    const ordered = outbound ? external : [from!, ...external.filter((p) => p.address !== from!.address)];
    const person = ordered[0];
    if (!outbound) {
      if (external.length > 6) continue; // a blast to a list
      const known = await prisma.ilContact.findFirst({ where: { email: { equals: person.address, mode: "insensitive" } }, select: { id: true } });
      const isReply = /^\s*(re|fwd?|fw|תגובה|השב|הועבר)\s*:/i.test(m.subject ?? "");
      if (!known && !isReply) continue; // a stranger's first email: wait until we answer
    }
    const { id: contactId, companyId } = await contactFor(person);
    const when = new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now());
    await prisma.ilActivity.create({
      data: {
        type: "EMAIL",
        direction: outbound ? "OUTBOUND" : "INBOUND",
        subject: m.subject ?? "(no subject)",
        body: m.bodyPreview ?? null,
        occurredAt: when,
        externalId: ext,
        contactId,
        companyId,
        dealId: await dealFor(contactId),
        meta: JSON.stringify({ from, to, cc, mailbox, hasAttachments: m.hasAttachments ?? false }),
      },
    }).catch(() => null);
    await Promise.all([
      prisma.ilContact.updateMany({ where: { id: contactId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }),
      companyId ? prisma.ilCompany.updateMany({ where: { id: companyId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null,
    ]);
    logged++;
  }
  if (user) await prisma.user.update({ where: { id: user.id }, data: { israelMailSyncedAt: startedAt } });
  else await prisma.ilSyncState.upsert({ where: { mailbox: mailbox.toLowerCase() }, create: { mailbox: mailbox.toLowerCase(), syncedAt: startedAt }, update: { syncedAt: startedAt } });
  return { scanned: messages.length, logged };
}

export async function syncIsraelMailboxes(): Promise<Record<string, { scanned: number; logged: number } | string>> {
  if (!israelMailConfigured()) return {};
  const out: Record<string, { scanned: number; logged: number } | string> = {};
  for (const box of await israelMailboxes()) {
    try {
      out[box] = await syncIsraelMailbox(box);
    } catch (e) {
      out[box] = String(e instanceof Error ? e.message : e).slice(0, 160);
    }
  }
  return out;
}

/** Called from RJL Israel page loads: refresh the log in the background if it has been a while. */
let lastKick = 0;
export function kickIsraelMailSync(minMinutes = 3) {
  if (!israelMailConfigured() || Date.now() - lastKick < minMinutes * 60_000) return;
  lastKick = Date.now();
  const run = async () => {
    await syncIsraelMailboxes().catch(() => ({}));
    const { processIsraelInbox } = await import("@/lib/israel-intake");
    await processIsraelInbox().catch(() => ({}));
    const { detectIsraelMentions, closeLandedMentions } = await import("@/lib/israel-mentions");
    await detectIsraelMentions().catch(() => ({}));
    await closeLandedMentions().catch(() => 0);
  };
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => void run());
}
