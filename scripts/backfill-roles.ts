/* Contacts inherit their company's roles (Sponsor / Investor / ...). Re-runnable. */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { backfillContactRoles } from "../src/lib/roles";

(async () => {
  const before = await prisma.contact.count({ where: { roles: "[]" } });
  const changed = await backfillContactRoles(console.log);
  const after = await prisma.contact.count({ where: { roles: "[]" } });
  console.log(`Updated ${changed} contacts. Contacts with no role: ${before} -> ${after}`);
  await prisma.$disconnect();
})();
