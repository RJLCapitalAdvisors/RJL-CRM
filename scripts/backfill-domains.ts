/* Company domains from contact emails; link stray contacts; create companies for unmatched corporate domains. Re-runnable. */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { backfillDomains } from "../src/lib/domains";

(async () => {
  const before = await prisma.contact.count({ where: { companyId: null } });
  const r = await backfillDomains(console.log);
  const after = await prisma.contact.count({ where: { companyId: null } });
  console.log(`contacts without a company: ${before} -> ${after}`, r);
  await prisma.$disconnect();
})();
