import { prisma } from "../src/lib/db";
import { mergeCompanies, mergeContacts } from "../src/lib/merge-companies";
import { parseList, toJson } from "../src/lib/taxonomy";

const GTIS = "cmtlzxz7q0125ujq01xc478wn"; // kept: has the criteria
const BRIGHT = "cmuququ200020id04pc636qgn"; // folded in
const NEW_NAME = "Brightshore Capital (formerly GTIS Partners)";
// the same two people under both addresses: the old GTIS record folds into the Brightshore one (the address they write from now)
const PEOPLE: [string, string][] = [
  ["cmtlzzd0v0i43ujq01gy42w55", "cmuququ2h0022id042hoa0r1l"], // Nate Tauber
  ["cmtlzzdfi0ib3ujq014sno32d", "cmuququ540024id04hdgq845r"], // James Holleman
];

async function main() {
  const dry = process.argv.includes("--dry");
  const log = (s: string) => console.log("  " + s);
  const [g, b] = await Promise.all([prisma.company.findUnique({ where: { id: GTIS }, select: { name: true, domain: true, criteria: { select: { id: true } } } }), prisma.company.findUnique({ where: { id: BRIGHT }, select: { name: true, domain: true } })]);
  if (g?.name !== "GTIS Partners" || b?.name !== "Brightshore Capital" || !g.criteria) throw new Error("not the expected pair");
  for (const [from, into] of PEOPLE) {
    const [f, i] = await Promise.all([prisma.contact.findUnique({ where: { id: from }, select: { email: true, lastName: true } }), prisma.contact.findUnique({ where: { id: into }, select: { email: true, lastName: true } })]);
    if (!f || !i || f.lastName !== i.lastName) throw new Error(`person pair mismatch ${from} ${into}`);
    console.log(`person: ${f.email} -> ${i.email}`);
  }
  if (dry) return console.log("dry run, nothing changed");

  console.log("merging people");
  for (const [from, into] of PEOPLE) await mergeContacts(from, into, log);

  // one report row per deal for the firm: James's row (deal sent, no note) folds into Nate's, which carries the firm's answer
  console.log("merging report rows");
  const nate = PEOPLE[0][1], james = PEOPLE[1][1];
  for (const jr of await prisma.dealInvestor.findMany({ where: { contactId: james } })) {
    const nr = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: jr.dealId, contactId: nate } } });
    if (!nr) continue;
    const extras = new Set([...parseList(nr.extraContactIds), ...parseList(jr.extraContactIds), james].filter((x) => x !== nate));
    await prisma.dealInvestor.update({ where: { id: nr.id }, data: { status: Math.max(nr.status, jr.status), note: [nr.note?.trim(), jr.note?.trim()].filter(Boolean).join("\n") || null, extraContactIds: toJson([...extras]), openingLine: nr.openingLine ?? jr.openingLine } });
    await prisma.dealInvestor.delete({ where: { id: jr.id } });
    log(`row on deal ${jr.dealId}: James's folded into Nate's (status ${Math.max(nr.status, jr.status)})`);
  }

  console.log("merging companies");
  await mergeCompanies(BRIGHT, GTIS, log);
  // the new name and address: brightshore.com is the domain now, gtispartners.com stays as the alternate
  await prisma.company.update({ where: { id: GTIS }, data: { name: NEW_NAME, domain: "brightshore.com", altDomains: toJson(["gtispartners.com"]), website: "https://brightshore.com" } });

  const after = await prisma.company.findUnique({ where: { id: GTIS }, select: { name: true, domain: true, altDomains: true, website: true, criteria: { select: { assetClasses: true, checkMinMM: true, checkMaxMM: true, investmentTypes: true } }, _count: { select: { contacts: true, activities: true, partyOf: true } } } });
  console.log("after:", JSON.stringify(after));
  const rows = await prisma.dealInvestor.findMany({ where: { contact: { companyId: GTIS } }, select: { status: true, note: true, extraContactIds: true, deal: { select: { name: true } }, contact: { select: { email: true } } } });
  for (const r of rows) console.log(`row: ${r.deal.name} | ${r.contact.email} | ${r.status} | extras ${r.extraContactIds} | ${(r.note ?? "").slice(0, 80)}`);
  console.log("people:", (await prisma.contact.findMany({ where: { companyId: GTIS, firstName: { not: null } }, select: { email: true, firstName: true, lastName: true } })).map((k) => `${k.firstName} ${k.lastName} <${k.email}>`));
}
main().finally(() => prisma.$disconnect());
