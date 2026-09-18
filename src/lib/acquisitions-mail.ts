import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
import { domainOf, mailReadsFor } from "@/lib/access";
import { FREE_MAIL, nameFromDomain } from "@/lib/domains";
import { mergeAqRoles } from "@/lib/acquisitions";

/**
 * RJL Acquisitions email log. The mailboxes of the people Jonathan listed with Acquisitions access and no RJL CA
 * access (Shawn) are read here instead of into the RJL Capital Advisors log: every outside correspondent becomes
 * a contact (and their company, from the email domain), every exchange an activity on both. An email to an
 * @rjlisrael.com address is RJL Israel's business and is read by that side, never here.
 */
type Party = { address: string; name?: string };
type Msg = { id: string; internetMessageId?: string; subject: string | null; bodyPreview?: string; receivedDateTime?: string; sentDateTime?: string; hasAttachments?: boolean; isDraft?: boolean; inferenceClassification?: string; from?: { emailAddress: Party }; toRecipients?: { emailAddress: Party }[]; ccRecipients?: { emailAddress: Party }[] };

const INTERNAL = new Set(["rjlcapadvisors.com", "rjlequities.com", "rjlisrael.com", "liviemisrael.com"]);
const MAILER = /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|notify|mailer-daemon|postmaster|bounces?|newsletters?|marketing|news|updates?|digest|alerts?|calendar-notification|support|info|admin|billing|invoice|receipts?)@/i;
const BULK_DOMAINS = ["linkedin.com", "facebookmail.com", "google.com", "microsoft.com", "costar.com", "loopnet.com", "crexi.com", "docusign.net", "zoom.us", "calendly.com", "hubspot.com", "mailchimp.com", "constantcontact.com", "salesforce.com", "notion.so", "dropbox.com", "box.com"];
const BULK_WORDS = /\b(unsubscribe|newsletter|weekly (highlights|update|digest)|webinar|you're invited|% off|limited time|new listings? (this|for you)|your (order|receipt|invoice|statement)|verify your|password|security alert)\b/i;
const FIRST_SYNC_DAYS = 120;
const PAGE = 50;
const q = encodeURIComponent;

const isInternal = (a: string) => INTERNAL.has(domainOf(a));
const isMailer = (a: string) => MAILER.test(a.toLowerCase()) || BULK_DOMAINS.some((d) => domainOf(a) === d || domainOf(a).endsWith("." + d));
const looksBulk = (m: Msg) => m.inferenceClassification === "other" || BULK_WORDS.test(`${m.subject ?? ""} ${m.bodyPreview ?? ""}`);
const rootDomain = (d: string) => {
  const parts = d.split(".");
  const two = /^(co|org|net|ac|gov)$/.test(parts[parts.length - 2] ?? "") && parts.length > 2 ? 3 : 2;
  return parts.slice(-two).join(".");
};
const splitName = (display: string | undefined, address: string): { firstName: string | null; lastName: string | null } => {
  let n = (display ?? "").replace(/^["']|["']$/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!n || n.includes("@")) n = address.split("@")[0].split(/[._-]/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "")).join(" ").trim();
  if (n.includes(",")) {
    const [l, f] = n.split(",").map((x) => x.trim());
    n = `${f} ${l}`;
  }
  const parts = n.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
};

/** The Acquisitions mailboxes: active people whose RJL CA address has Email reading pointed at this side (Settings > Users). */
export async function acquisitionsMailboxes(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { active: true, email: { not: null } }, select: { email: true, israelEmail: true, workspaces: true, mailReads: true } });
  return users.filter((u) => mailReadsFor(u).includes("AQ")).map((u) => u.email!.toLowerCase());
}

async function pageThrough(mailbox: string, folder: "sentitems" | "inbox", since: Date): Promise<Msg[]> {
  const out: Msg[] = [];
  let url: string | null = `/users/${q(mailbox)}/mailFolders/${folder}/messages?$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime desc&$top=${PAGE}&$select=id,internetMessageId,subject,bodyPreview,receivedDateTime,sentDateTime,hasAttachments,isDraft,inferenceClassification,from,toRecipients,ccRecipients`;
  while (url && out.length < 2000) {
    const r: { value: Msg[]; "@odata.nextLink"?: string } = await graph(url);
    out.push(...r.value.filter((m) => !m.isDraft));
    url = r["@odata.nextLink"] ?? null;
  }
  return out;
}

/** The company behind an email domain, created on first sight and named after the domain. Free-mail addresses have none. */
async function companyForDomain(domain: string): Promise<string | null> {
  if (!domain || FREE_MAIL.has(domain)) return null;
  domain = rootDomain(domain);
  if (FREE_MAIL.has(domain)) return null;
  const existing = (await prisma.aqCompany.findFirst({ where: { domain }, select: { id: true } })) ?? (await prisma.aqCompany.findFirst({ where: { website: { contains: domain, mode: "insensitive" } }, select: { id: true } }));
  if (existing) {
    await prisma.aqCompany.updateMany({ where: { id: existing.id, domain: null }, data: { domain } });
    return existing.id;
  }
  const co = await prisma.aqCompany.create({ data: { name: nameFromDomain(domain), domain, website: `https://${domain}` }, select: { id: true } });
  return co.id;
}

/** The contact for an outside correspondent, created from the email when unknown; a person at a company carries its roles. */
async function contactFor(p: Party): Promise<{ id: string; companyId: string | null }> {
  const email = p.address.toLowerCase();
  const found = await prisma.aqContact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, companyId: true, firstName: true, lastName: true, roles: true } });
  const companyId = await companyForDomain(domainOf(email));
  if (found) {
    const data: { companyId?: string; firstName?: string | null; lastName?: string | null; roles?: string } = {};
    if (!found.companyId && companyId) {
      data.companyId = companyId;
      const co = await prisma.aqCompany.findUnique({ where: { id: companyId }, select: { roles: true } });
      if (co) data.roles = mergeAqRoles(found.roles, co.roles);
    }
    if (!found.firstName && !found.lastName && p.name && !p.name.includes("@")) Object.assign(data, splitName(p.name, email));
    if (Object.keys(data).length) await prisma.aqContact.update({ where: { id: found.id }, data }).catch(() => null);
    return { id: found.id, companyId: found.companyId ?? companyId };
  }
  const co = companyId ? await prisma.aqCompany.findUnique({ where: { id: companyId }, select: { roles: true } }) : null;
  const c = await prisma.aqContact.create({ data: { ...splitName(p.name, email), email, companyId, roles: co?.roles ?? "[]" }, select: { id: true } });
  return { id: c.id, companyId };
}

/** The one property this person is linked to, if exactly one, so the email lands on the property too. */
async function propertyFor(contactId: string): Promise<string | null> {
  const links = await prisma.aqPropertyContact.findMany({ where: { contactId }, select: { propertyId: true }, take: 2 });
  return links.length === 1 ? links[0].propertyId : null;
}

export async function syncAcquisitionsMailbox(mailbox: string): Promise<{ scanned: number; logged: number }> {
  const user = await prisma.user.findFirst({ where: { email: { equals: mailbox, mode: "insensitive" } } });
  const OVERLAP_MS = 90 * 60_000;
  const last = user?.acqMailSyncedAt ?? null;
  const since = last ? new Date(last.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  const startedAt = new Date();
  const [sent, inbox] = await Promise.all([pageThrough(mailbox, "sentitems", since), pageThrough(mailbox, "inbox", since)]);
  const messages = [...sent, ...inbox];
  let logged = 0;
  for (const m of messages) {
    const ext = m.internetMessageId ?? m.id;
    if (await prisma.aqActivity.findUnique({ where: { externalId: ext }, select: { id: true } })) continue;
    const from = m.from?.emailAddress;
    const to = (m.toRecipients ?? []).map((r) => r.emailAddress);
    const cc = (m.ccRecipients ?? []).map((r) => r.emailAddress);
    const everyone = [from, ...to, ...cc].filter((p): p is Party => Boolean(p?.address));
    const external = everyone.filter((p) => !isInternal(p.address) && !isMailer(p.address));
    if (!external.length) continue;
    const outbound = from ? isInternal(from.address) : false;
    if (!outbound && from && isMailer(from.address)) continue;
    if (!outbound && looksBulk(m)) continue;
    if (!outbound && ![...to, ...cc].some((p) => p.address.toLowerCase() === mailbox.toLowerCase() || isInternal(p.address))) continue;
    const ordered = outbound ? external : [from!, ...external.filter((p) => p.address !== from!.address)];
    const person = ordered[0];
    if (!outbound) {
      if (external.length > 6) continue; // a blast to a list
      const known = await prisma.aqContact.findFirst({ where: { email: { equals: person.address, mode: "insensitive" } }, select: { id: true } });
      const isReply = /^\s*(re|fwd?|fw)\s*:/i.test(m.subject ?? "");
      if (!known && !isReply) continue; // a stranger's first email waits until we answer
    }
    const { id: contactId, companyId } = await contactFor(person);
    const when = new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now());
    await prisma.aqActivity
      .create({
        data: {
          type: "EMAIL",
          direction: outbound ? "OUTBOUND" : "INBOUND",
          subject: m.subject ?? "(no subject)",
          body: m.bodyPreview ?? null,
          occurredAt: when,
          externalId: ext,
          contactId,
          companyId,
          propertyId: await propertyFor(contactId),
          meta: JSON.stringify({ from, to, cc, mailbox, hasAttachments: m.hasAttachments ?? false }),
        },
      })
      .catch(() => null);
    await Promise.all([
      prisma.aqContact.updateMany({ where: { id: contactId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }),
      companyId ? prisma.aqCompany.updateMany({ where: { id: companyId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null,
    ]);
    logged++;
  }
  if (user) await prisma.user.update({ where: { id: user.id }, data: { acqMailSyncedAt: startedAt } });
  return { scanned: messages.length, logged };
}

export async function syncAcquisitionsMailboxes(): Promise<Record<string, { scanned: number; logged: number } | string>> {
  if (!graphConfigured()) return {};
  const out: Record<string, { scanned: number; logged: number } | string> = {};
  for (const box of await acquisitionsMailboxes()) {
    try {
      out[box] = await syncAcquisitionsMailbox(box);
    } catch (e) {
      out[box] = String(e instanceof Error ? e.message : e).slice(0, 160);
    }
  }
  return out;
}

/** Called from RJL Acquisitions page loads: refresh the log in the background if it has been a while. */
let lastKick = 0;
export function kickAcquisitionsMailSync(minMinutes = 3) {
  if (!graphConfigured() || Date.now() - lastKick < minMinutes * 60_000) return;
  lastKick = Date.now();
  const run = async () => {
    await syncAcquisitionsMailboxes().catch(() => ({}));
  };
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => void run());
}
