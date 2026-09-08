/**
 * One-off: register every intake email and its attachments as DealEmail / DealFile, and fold the duplicate
 * Westwind ticket (created from a follow-up before the CRM knew how to recognize one) into the real deal.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { graph } from "../src/lib/graph";
import { extractDealFacts, mergeIntoDeal, recordDealEmail, recordDealFiles } from "../src/lib/deal-knowledge";

const MAILBOX = process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com";
const q = (s: string) => encodeURIComponent(s);

async function graphIdFor(internetMessageId: string) {
  const r = await graph<{ value: { id: string; conversationId?: string; receivedDateTime?: string; from?: { emailAddress: { address: string } } }[] }>(`/users/${q(MAILBOX)}/messages?$filter=internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'&$select=id,conversationId,receivedDateTime,from`);
  return r.value[0] ?? null;
}

(async () => {
  const dupId = "cmtstz87u0002jq04zd6a6n01", realId = "cmtrp3ijj0002uj101yg2j96n";
  const dup = await prisma.deal.findUnique({ where: { id: dupId }, include: { investors: true } });
  const dupIntake = await prisma.dealIntake.findFirst({ where: { dealId: dupId } });
  if (dup && dupIntake?.messageId && dup.investors.length === 0) {
    const m = await graphIdFor(dupIntake.messageId);
    if (m) {
      await recordDealEmail(realId, { messageId: dupIntake.messageId, graphId: m.id, conversationId: m.conversationId, subject: dupIntake.subject, fromEmail: dupIntake.fromEmail, receivedAt: new Date(m.receivedDateTime ?? dupIntake.createdAt), kind: "FOLLOWUP" });
      const files = await recordDealFiles(realId, MAILBOX, m.id, dupIntake.fromEmail, new Date(m.receivedDateTime ?? dupIntake.createdAt));
      const facts = await extractDealFacts(realId, dupIntake.rawText, `${(dupIntake.subject ?? "").replace(/^\s*((fw|fwd|re):\s*)+/i, "")} (Sep 8)`);
      const filled = await mergeIntoDeal(realId, dupIntake.rawText, dupIntake.subject ?? "");
      console.log(`folded follow-up into Westwind: files ${files}, facts ${facts}, fields filled ${filled}`);
    }
    await prisma.dealIntake.update({ where: { id: dupIntake.id }, data: { dealId: null, status: "CONVERTED", notes: `Follow-up on existing deal ${realId}` } });
    await prisma.deal.delete({ where: { id: dupId } });
    console.log("duplicate Westwind ticket removed");
  }
  // every other intake: record the email + files
  const intakes = await prisma.dealIntake.findMany({ where: { dealId: { not: null }, messageId: { not: null } } });
  let n = 0;
  for (const it of intakes) {
    if (await prisma.dealEmail.findUnique({ where: { messageId: it.messageId! } })) continue;
    const m = await graphIdFor(it.messageId!).catch(() => null);
    if (!m) continue;
    await recordDealEmail(it.dealId!, { messageId: it.messageId!, graphId: m.id, conversationId: m.conversationId, subject: it.subject, fromEmail: it.fromEmail, receivedAt: new Date(m.receivedDateTime ?? it.createdAt), kind: "INTAKE" });
    const files = await recordDealFiles(it.dealId!, MAILBOX, m.id, it.fromEmail, new Date(m.receivedDateTime ?? it.createdAt)).catch(() => 0);
    n++;
    console.log(`registered intake for deal ${it.dealId}: ${files} files`);
  }
  console.log("intakes registered:", n);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
