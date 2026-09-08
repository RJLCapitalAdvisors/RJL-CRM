import "dotenv/config";
import { prisma } from "../src/lib/db";
import { refreshResponses } from "../src/lib/refresh-responses";
(async () => {
  const id = "cmtm00p200ya9ujq0eelmkzdo";
  const r = await refreshResponses(id);
  console.log("refresh:", JSON.stringify(r));
  const rows = await prisma.dealInvestor.findMany({ where: { dealId: id }, include: { contact: { include: { company: { select: { name: true } } } } }, orderBy: { status: "desc" } });
  for (const x of rows) console.log(`  ${x.contact.company?.name ?? x.contact.email} | status ${x.status} | ${(x.note ?? "").slice(0, 140)}`);
  const asks = await prisma.momentum.findMany({ where: { dealId: id, kind: "LP_ASK", status: "OPEN" }, select: { party: true, summary: true } });
  for (const a of asks) console.log("  LP ask:", a.party, "|", a.summary.slice(0, 140));
  await prisma.$disconnect();
})();
