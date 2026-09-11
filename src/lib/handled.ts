import { prisma } from "@/lib/db";
import { graphConfigured, sentMessagesTo } from "@/lib/graph";

/**
 * "Handle, then send" takes the item off the dashboard. Every Handle button records when it was clicked and from
 * whose mailbox; this pass looks for an email that mailbox sent to the party since the click (the email log first,
 * Sent Items itself when the log has not caught up) and closes the item. Deal momentum items close as DONE with the
 * sent email as their latest message, so the refresh does not reopen them until the other side writes back; a quiet
 * deal that was checked in on leaves Data updates for another quiet spell.
 */
type Sent = { at: Date; messageId: string | null };

async function sentSince(mailbox: string, since: Date, emails: string[], contactIds: string[], companyIds: string[]): Promise<Sent | null> {
  const logged = await prisma.activity.findFirst({
    where: { type: "EMAIL", direction: "OUTBOUND", occurredAt: { gt: since }, OR: [...(contactIds.length ? [{ contactId: { in: contactIds } }] : []), ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []), ...(emails.length ? [{ contact: { email: { in: emails } } }] : [])] },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true, externalId: true },
  });
  if (logged) return { at: logged.occurredAt, messageId: logged.externalId };
  if (!graphConfigured()) return null;
  for (const email of emails.slice(0, 4)) {
    const sent = await sentMessagesTo(mailbox, email, 5).catch(() => []);
    const hit = sent.find((m) => m.sentDateTime && new Date(m.sentDateTime) > since);
    if (hit?.sentDateTime) return { at: new Date(hit.sentDateTime), messageId: hit.internetMessageId ?? null };
  }
  return null;
}

async function partyEmails(contactId: string | null, companyId: string | null): Promise<{ emails: string[]; contactIds: string[]; companyIds: string[] }> {
  const emails = new Set<string>();
  const contactIds: string[] = [];
  const companyIds: string[] = [];
  if (contactId) {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { email: true, companyId: true } });
    if (c?.email) emails.add(c.email.toLowerCase());
    contactIds.push(contactId);
    if (c?.companyId) companyIds.push(c.companyId);
  }
  if (companyId) {
    companyIds.push(companyId);
    const people = await prisma.contact.findMany({ where: { companyId, email: { not: null }, departedAt: null }, select: { email: true }, orderBy: { lastActivityAt: "desc" }, take: 6 });
    for (const p of people) if (p.email) emails.add(p.email.toLowerCase());
  }
  return { emails: [...emails], contactIds, companyIds: [...new Set(companyIds)] };
}

/** Deal momentum items whose Handle email went out. */
export async function syncHandledMomentum(): Promise<number> {
  const rows = await prisma.momentum.findMany({ where: { status: "OPEN", handledAt: { not: null }, handledBy: { not: null } } });
  let n = 0;
  for (const m of rows) {
    try {
      const party = await partyEmails(m.contactId, m.companyId);
      if (!party.emails.length && !party.companyIds.length) continue;
      const sent = await sentSince(m.handledBy!, m.handledAt!, party.emails, party.contactIds, party.companyIds);
      if (!sent) continue;
      await prisma.momentum.update({ where: { id: m.id }, data: { status: "DONE", lastMessageId: sent.messageId ?? m.lastMessageId, handledAt: null, handledBy: null } });
      n++;
    } catch {
      /* next item */
    }
  }
  return n;
}

/** Quiet deals whose check-in email went out: they leave Data updates for another quiet spell. */
export async function syncHandledStale(): Promise<number> {
  const deals = await prisma.deal.findMany({ where: { staleHandledAt: { not: null }, staleHandledBy: { not: null } }, select: { id: true, staleHandledAt: true, staleHandledBy: true, sponsorCompanyId: true } });
  let n = 0;
  for (const d of deals) {
    try {
      const { sponsorContactsFor } = await import("@/lib/engagement");
      const people = await sponsorContactsFor(d.id).catch(() => []);
      const emails = people.map((p) => p.email.toLowerCase());
      const sent = await sentSince(d.staleHandledBy!, d.staleHandledAt!, emails, people.map((p) => p.id), d.sponsorCompanyId ? [d.sponsorCompanyId] : []);
      if (!sent) {
        // the check-in never went out after a week: ask again
        if (Date.now() - d.staleHandledAt!.getTime() > 7 * 86_400_000) await prisma.deal.update({ where: { id: d.id }, data: { staleHandledAt: null, staleHandledBy: null } });
        continue;
      }
      await prisma.deal.update({ where: { id: d.id }, data: { staleCheckedAt: sent.at, staleHandledAt: null, staleHandledBy: null } });
      n++;
    } catch {
      /* next deal */
    }
  }
  return n;
}
