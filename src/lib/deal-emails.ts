import { prisma } from "@/lib/db";
import { dealPhrases, subjectLooselyMatchesDeal, subjectMatchesDeal, words } from "@/lib/deal-match";
import type { EmailRow } from "@/components/email-log";

/**
 * Every email that pertains to a deal, for the window in the middle of the ticket: what the team sent the LPs,
 * what came back, what we asked the sponsor for, and what reached deals@. Emails the sync did not tag with
 * the deal (different subject wording, HubSpot-era imports) are matched on the deal's names here and tagged
 * for good, so the rest of the CRM (momentum, engagement) sees them too.
 */
export async function dealEmailRows(dealId: string): Promise<EmailRow[]> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { name: true, propertyName: true, sponsorName: true, city: true, sponsorCompanyId: true } });
  if (!deal) return [];
  const include = { contact: { select: { id: true, firstName: true, lastName: true } } };
  const linked = await prisma.activity.findMany({ where: { dealId, type: "EMAIL" }, orderBy: { occurredAt: "desc" }, take: 200, include });

  // candidates by subject: the deal's phrases, or the distinctive words of its property name
  const phrases = dealPhrases(deal);
  const ws = words(deal.propertyName ?? deal.name);
  const or = [...phrases.map((p) => ({ subject: { contains: p.replace(/,\s*[A-Z]{2}\.?$/, ""), mode: "insensitive" as const } })), ...(ws.length && ws.length <= 3 ? ws.map((w) => ({ subject: { contains: w, mode: "insensitive" as const } })) : [])];
  let matched: typeof linked = [];
  if (or.length) {
    const cands = await prisma.activity.findMany({ where: { type: "EMAIL", dealId: null, OR: or }, orderBy: { occurredAt: "desc" }, take: 400, include });
    matched = cands.filter((a) => subjectMatchesDeal(a.subject, deal));
    if (matched.length) await prisma.activity.updateMany({ where: { id: { in: matched.map((a) => a.id) }, dealId: null }, data: { dealId } }).catch(() => null);
  }

  // people already tied to the deal (on its report, at the sponsor): the city or one property word in the subject is enough
  const trackerContactIds = (await prisma.dealInvestor.findMany({ where: { dealId }, select: { contactId: true } })).map((r) => r.contactId);
  const tiedOr = [...(trackerContactIds.length ? [{ contactId: { in: trackerContactIds } }] : []), ...(deal.sponsorCompanyId ? [{ companyId: deal.sponsorCompanyId }] : [])];
  if (tiedOr.length) {
    const already = new Set(matched.map((a) => a.id));
    const tied = await prisma.activity.findMany({ where: { type: "EMAIL", dealId: null, OR: tiedOr }, orderBy: { occurredAt: "desc" }, take: 800, include });
    const more = tied.filter((a) => !already.has(a.id) && subjectLooselyMatchesDeal(a.subject, deal));
    if (more.length) {
      await prisma.activity.updateMany({ where: { id: { in: more.map((a) => a.id) }, dealId: null }, data: { dealId } }).catch(() => null);
      matched = [...matched, ...more];
    }
  }

  // what reached deals@ (the forward that opened the ticket, the sponsor's follow-ups)
  const seen = new Set([...linked, ...matched].map((a) => a.externalId).filter(Boolean));
  const inbox = await prisma.dealEmail.findMany({ where: { dealId }, orderBy: { receivedAt: "desc" } });
  const inboxRows: EmailRow[] = inbox
    .filter((e) => !seen.has(e.messageId))
    .map((e) => ({ id: `deals-${e.id}`, type: "EMAIL", subject: e.subject, body: e.kind === "INTAKE" ? "The forward that opened this ticket. Its files are under Attachments." : "Follow-up on this deal. Files went to Attachments, answers to Questions answered.", direction: "INBOUND", occurredAt: e.receivedAt, meta: JSON.stringify({ from: e.fromEmail ? { address: e.fromEmail } : undefined, mailbox: process.env.DEALS_MAILBOX ?? "deals@" }) }));

  return [...linked, ...matched, ...inboxRows].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
