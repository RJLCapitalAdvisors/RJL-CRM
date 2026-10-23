import { prisma } from "../src/lib/db";
import { mergeCompanies } from "../src/lib/merge-companies";
import { parseList, toJson } from "../src/lib/taxonomy";

const KEEP = "cmtlzxyy600xlujq0c1thxsh5"; // torchlight.com
const FOLD = "cmtlzyhtt07qgujq0cwf3va5n"; // torchlightinvestors.com
const BRUSH_STUB = "cmufvnhc50003uj0wginvyr5r";
const JON_ROW = "cmvfq9yma0015jf08cfwqw1nr"; // Rocky Hill North, Jon Stein (departed), Deal Sent
const SYD_ROW = "cmvl52yf8000bjt08pso4rut7"; // Rocky Hill North, Sydney Mas, Pass

async function main() {
  const dry = process.argv.includes("--dry");
  const log = (s: string) => console.log("  " + s);
  const [keep, fold] = await Promise.all([
    prisma.company.findUnique({ where: { id: KEEP }, select: { name: true, domain: true, contacts: { select: { email: true, firstName: true, lastName: true, departedAt: true } } } }),
    prisma.company.findUnique({ where: { id: FOLD }, select: { name: true, domain: true, contacts: { select: { email: true, firstName: true, lastName: true } } } }),
  ]);
  console.log("keep:", keep?.name, keep?.domain, keep?.contacts.map((c) => `${c.firstName ?? ""} ${c.lastName ?? ""} <${c.email}>${c.departedAt ? " (departed)" : ""}`));
  console.log("fold:", fold?.name, fold?.domain, fold?.contacts.map((c) => `${c.firstName ?? ""} ${c.lastName ?? ""} <${c.email}>`));
  if (!keep || !fold || !/torchlight/i.test(keep.name) || !/torchlight/i.test(fold.name)) throw new Error("not the Torchlight pair");

  const [jon, syd] = await Promise.all([
    prisma.dealInvestor.findUnique({ where: { id: JON_ROW }, include: { contact: { select: { id: true, email: true, lastName: true } }, deal: { select: { name: true } } } }),
    prisma.dealInvestor.findUnique({ where: { id: SYD_ROW }, include: { contact: { select: { id: true, email: true, lastName: true } }, deal: { select: { name: true } } } }),
  ]);
  console.log("rows:", jon && `${jon.deal.name} / ${jon.contact.lastName} status ${jon.status} note=${JSON.stringify(jon.note)} extras=${jon.extraContactIds}`, "|", syd && `${syd.deal.name} / ${syd.contact.lastName} status ${syd.status} note=${JSON.stringify(syd.note)} extras=${syd.extraContactIds}`);
  if (!jon || !syd || jon.dealId !== syd.dealId || jon.contact.lastName !== "Stein" || syd.contact.lastName !== "Mas") throw new Error("not the Rocky Hill pair");

  const brush = await prisma.company.findUnique({ where: { id: BRUSH_STUB }, select: { name: true, domain: true, _count: { select: { contacts: true, deals: true, activities: true, partyOf: true } } } });
  console.log("brush stub:", brush);

  if (dry) return console.log("dry run, nothing changed");

  console.log("merging the nameless dlockwood@torchlightinvestors.com into Dan Lockwood");
  const { mergeContacts } = await import("../src/lib/merge-companies");
  const [danAlt, dan] = await Promise.all([prisma.contact.findUnique({ where: { email: "dlockwood@torchlightinvestors.com" }, select: { id: true } }), prisma.contact.findUnique({ where: { email: "dlockwood@torchlight.com" }, select: { id: true } })]);
  if (danAlt && dan) await mergeContacts(danAlt.id, dan.id, log);
  else log("Dan pair not found, skipped");

  console.log("merging companies");
  await mergeCompanies(FOLD, KEEP, log);

  console.log("merging Rocky Hill rows");
  const extras = new Set([...parseList(syd.extraContactIds), ...parseList(jon.extraContactIds), jon.contactId].filter((x) => x !== syd.contactId));
  const note = [syd.note?.trim(), jon.note?.trim()].filter(Boolean).join("\n") || null;
  await prisma.dealInvestor.update({ where: { id: SYD_ROW }, data: { note, extraContactIds: extras.size ? toJson([...extras]) : null, openingLine: syd.openingLine ?? jon.openingLine } });
  await prisma.dealInvestor.delete({ where: { id: JON_ROW } });
  log(`Sydney's row keeps status ${syd.status}; Jon Stein's row deleted; extras now ${[...extras].join(", ")}`);

  if (brush && !brush._count.contacts && !brush._count.deals && !brush._count.activities && !brush._count.partyOf) {
    await prisma.investorCriteria.deleteMany({ where: { companyId: BRUSH_STUB } });
    await prisma.criteriaProposal.updateMany({ where: { companyId: BRUSH_STUB }, data: { companyId: null } });
    await prisma.momentum.deleteMany({ where: { companyId: BRUSH_STUB } });
    await prisma.mentionScan.deleteMany({ where: { companyId: BRUSH_STUB } });
    await prisma.company.delete({ where: { id: BRUSH_STUB } });
    log(`deleted the empty ${brush.name} stub`);
  } else log("brush stub not empty, left alone");

  const after = await prisma.company.findUnique({ where: { id: KEEP }, select: { name: true, domain: true, altDomains: true, notes: true, contacts: { select: { email: true, firstName: true, lastName: true, departedAt: true, companyId: true } }, _count: { select: { activities: true, partyOf: true, deals: true } } } });
  console.log("after:", JSON.stringify(after, null, 1));
  console.log("rocky hill torchlight rows:", await prisma.dealInvestor.findMany({ where: { dealId: syd.dealId, contact: { companyId: KEEP } }, select: { id: true, status: true, note: true, extraContactIds: true, contact: { select: { email: true } } } }));
}
main().finally(() => prisma.$disconnect());
