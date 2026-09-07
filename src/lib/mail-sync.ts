import { prisma } from "@/lib/db";
import { graph, graphConfigured, type GraphMessage } from "@/lib/graph";
import { domainOf } from "@/lib/domains";
import { ACTIVE_STAGES } from "@/lib/taxonomy";

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

export async function syncMailbox(mailbox: string): Promise<{ scanned: number; logged: number }> {
  const user = await prisma.user.findFirst({ where: { email: { equals: mailbox, mode: "insensitive" } } });
  const since = user?.mailSyncedAt ?? new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  const startedAt = new Date();
  const [sent, inbox] = await Promise.all([pageThrough(mailbox, "sentitems", since), pageThrough(mailbox, "inbox", since)]);
  const messages = [...sent, ...inbox];

  const activeDeals = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] } }, select: { id: true, name: true, propertyName: true } });
  const dealFor = (subject: string) => {
    const s = subject.toLowerCase();
    return activeDeals.find((d) => {
      const n = (d.propertyName ?? d.name).toLowerCase();
      return n.length > 5 && s.includes(n);
    })?.id;
  };

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
    if (!contactId && !companyId) continue; // nobody we track

    const when = new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now());
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
        dealId: dealFor(m.subject ?? "") ?? null,
        meta: JSON.stringify({ from, to, cc, mailbox, hasAttachments: m.hasAttachments ?? false }),
      },
    });
    const bump = [contactId ? prisma.contact.updateMany({ where: { id: contactId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null, companyId ? prisma.company.updateMany({ where: { id: companyId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] }, data: { lastActivityAt: when } }) : null];
    await Promise.all(bump);
    logged++;
  }
  if (user) await prisma.user.update({ where: { id: user.id }, data: { mailSyncedAt: startedAt } });
  return { scanned: messages.length, logged };
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
export function kickMailSync(minMinutes = 10) {
  if (!graphConfigured() || Date.now() - lastKick < minMinutes * 60_000) return;
  lastKick = Date.now();
  const run = async () => {
    await syncAllMailboxes().catch(() => ({}));
    const { processDealsInbox } = await import("@/lib/deals-inbox");
    await processDealsInbox().catch(() => ({}));
    const { refreshMomentum } = await import("@/lib/momentum");
    await refreshMomentum().catch(() => ({}));
  };
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => void run());
}
