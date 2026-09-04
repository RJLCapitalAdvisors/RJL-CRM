/* Set the active team: upsert by name, attach emails, deactivate everyone else, merge duplicates. Re-runnable. */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const TEAM: { name: string; email: string; aliases?: string[] }[] = [
  { name: "Jonathan Livi", email: "jonathan@rjlcapadvisors.com" },
  { name: "Aviel Livian", email: "aviel@rjlcapadvisors.com" },
  { name: "Shawn Aziz", email: "shawn@rjlcapadvisors.com" },
  { name: "Esther Livi", email: "esther@rjlcapadvisors.com" },
  { name: "Nikko Acosta", email: "nikko@rjlcapadvisors.com", aliases: ["Nikko Joseph Acosta"] },
];

(async () => {
  const keep = new Set<string>();
  for (const t of TEAM) {
    let user = await prisma.user.findFirst({ where: { name: t.name } });
    if (user) user = await prisma.user.update({ where: { id: user.id }, data: { email: t.email, active: true } });
    else user = await prisma.user.create({ data: { name: t.name, email: t.email, active: true } });
    keep.add(user.id);
    for (const alias of t.aliases ?? []) {
      const dup = await prisma.user.findFirst({ where: { name: alias } });
      if (!dup) continue;
      const [c, k, d] = await Promise.all([
        prisma.company.updateMany({ where: { ownerId: dup.id }, data: { ownerId: user.id } }),
        prisma.contact.updateMany({ where: { ownerId: dup.id }, data: { ownerId: user.id } }),
        prisma.deal.updateMany({ where: { ownerId: dup.id }, data: { ownerId: user.id } }),
      ]);
      await prisma.user.delete({ where: { id: dup.id } });
      console.log(`merged "${alias}" into "${t.name}" (${c.count} companies, ${k.count} contacts, ${d.count} deals)`);
    }
    console.log(`active  ${t.name} <${t.email}>`);
  }
  const others = await prisma.user.updateMany({ where: { id: { notIn: Array.from(keep) } }, data: { active: false } });
  console.log(`deactivated ${others.count} former users (their history stays on the records)`);
  await prisma.$disconnect();
})();
