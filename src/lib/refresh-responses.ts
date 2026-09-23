import { prisma } from "@/lib/db";
import { dealResolver, syncAllMailboxes } from "@/lib/mail-sync";
import { noteDealSent } from "@/lib/deal-outbound";
import { graph } from "@/lib/graph";

/**
 * "Refresh responses" on a progress report: pull the latest mail from every team mailbox, tie any email from
 * or to the firms on this report to the deal, forget earlier "not about a deal" verdicts on those replies, and
 * re-read them for stance and asks (statuses and notes on the report, LP requests on the Dashboard).
 */
export async function refreshResponses(dealId: string): Promise<{ synced: number; linked: number; rescanned: number; asks: number }> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { investors: { include: { contact: { select: { id: true, companyId: true } } } } } });
  if (!deal) return { synced: 0, linked: 0, rescanned: 0, asks: 0 };
  const synced = Object.values(await syncAllMailboxes().catch(() => ({}))).reduce((n, v) => n + (typeof v === "object" ? v.logged : 0), 0);

  // every email with the firms on this report, or about the deal by name, from the last 180 days that is not yet tied to a deal
  const contactIds = deal.investors.map((r) => r.contactId);
  const companyIds = [...new Set(deal.investors.map((r) => r.contact.companyId).filter((x): x is string => Boolean(x)))];
  const since = new Date(Date.now() - 180 * 86_400_000);
  const acts = await prisma.activity.findMany({ where: { type: "EMAIL", dealId: null, occurredAt: { gte: since }, OR: [{ contactId: { in: contactIds } }, { companyId: { in: companyIds } }, ...[deal.city, deal.propertyName].filter((x): x is string => Boolean(x)).map((x) => ({ subject: { contains: x, mode: "insensitive" as const } }))] }, orderBy: { occurredAt: "asc" } });
  const dealFor = await dealResolver();
  let linked = 0;
  for (const a of acts) {
    const id = dealFor(a.subject ?? "", a.contactId, a.companyId);
    if (id !== dealId) continue;
    await prisma.activity.update({ where: { id: a.id }, data: { dealId } });
    linked++;
    if (a.direction === "OUTBOUND" && a.contactId && a.externalId) {
      const meta = a.meta ? (JSON.parse(a.meta) as { mailbox?: string; to?: { address: string }[]; hasAttachments?: boolean }) : {};
      if (meta.mailbox) {
        const found = await graph<{ value: { id: string }[] }>(`/users/${encodeURIComponent(meta.mailbox)}/messages?$filter=${encodeURIComponent(`internetMessageId eq '${a.externalId.replace(/'/g, "''")}'`)}&$select=id`).catch(() => ({ value: [] }));
        if (found.value[0]) await noteDealSent({ dealId, contactId: a.contactId, companyId: a.companyId, mailbox: meta.mailbox, graphId: found.value[0].id, hasAttachments: meta.hasAttachments ?? false, when: a.occurredAt, toEmails: (meta.to ?? []).map((t) => t.address) }).catch(() => false);
      }
    }
  }

  // replies on this deal get read again (earlier passes may have filed them as "no deal" before the deal was known)
  const inbound = await prisma.activity.findMany({ where: { type: "EMAIL", direction: "INBOUND", dealId, occurredAt: { gte: since }, externalId: { not: null } }, select: { externalId: true } });
  const rescanned = (await prisma.lpAskScan.deleteMany({ where: { externalId: { in: inbound.map((a) => a.externalId!) }, result: { notIn: [] } } })).count;
  const { refreshMomentum } = await import("@/lib/momentum");
  await refreshMomentum().catch(() => null);
  const asks = await prisma.momentum.count({ where: { dealId, kind: "LP_ASK", status: "OPEN" } });
  return { synced, linked, rescanned, asks };
}
