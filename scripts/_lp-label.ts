import { prisma } from "../src/lib/db";
import { parseList, toJson } from "../src/lib/taxonomy";

// Jonathan, Oct 26, 2026: the clear LPs the scan found without an Investor label
const TARGETS: { id: string; expect: RegExp; rename?: string }[] = [
  { id: "cmtlzxzf2015qujq08dq111vv", expect: /^Henley$/ },
  { id: "cmtlzy2w502igujq0i2b6xvw3", expect: /^Arkin$/ },
  { id: "cmtlzy0ek01bwujq0zz3u4nqv", expect: /^Range Equity Management$/ },
  { id: "cmtlzy0td01iyujq086jksfyc", expect: /^Saluda Grade$/ },
  { id: "cmtlzxz5d0117ujq006wah31p", expect: /^Matador Realty Investments$/ },
  { id: "cmtlzy0hc01dkujq0kap75x3z", expect: /^IBI/ },
  { id: "cmtlzy2w202ieujq0hhserszl", expect: /^Manglar Capital$/ },
  { id: "cmtlzxz350105ujq08mmo9nc9", expect: /Unnamed/, rename: "Hall Barrett Advisors" },
  { id: "cmtlzxy6q00knujq0a2gdn5c2", expect: /Unnamed/, rename: "AKCV Monroe" },
  { id: "cmtlzxyj900qvujq0vnifbn0a", expect: /^Arselle Investments$/ },
  { id: "cmtlzxxsm00dzujq0d4lgfk7s", expect: /^Winds Eye Capital$/ },
  { id: "cmtlzxy5w00k7ujq053vorma5", expect: /^Winter$/ },
  { id: "cmtlzxywn00wvujq0qod8r9uq", expect: /^West Development$/ },
  { id: "cmuymhya30005l304dsg2yi67", expect: /^Lgt$/, rename: "LGT" },
  { id: "cmtx341mf011rujr42f56vdrt", expect: /^Cascade Asset Management Company$/ },
  { id: "cmtx34dz30134ujr4a2y93ecs", expect: /^Icgplc$/, rename: "ICG plc" },
  { id: "cmtlzxz6f011lujq0n47izf05", expect: /^Divine Acquisitions$/ },
  { id: "cmtlzy84004jyujq0fv05cvag", expect: /^Loci Capital$/ },
];

async function main() {
  const dry = process.argv.includes("--dry");
  for (const t of TARGETS) {
    const co = await prisma.company.findUnique({ where: { id: t.id }, select: { id: true, name: true, domain: true, roles: true, contacts: { select: { id: true, email: true, roles: true } } } });
    if (!co) { console.log(`MISSING ${t.id}`); continue; }
    if (!t.expect.test(co.name)) { console.log(`SKIP ${co.name} (${t.id}) does not match ${t.expect}`); continue; }
    const roles = parseList(co.roles);
    const next = roles.includes("Investor") ? roles : [...roles, "Investor"];
    const peopleToFix = co.contacts.filter((k) => !parseList(k.roles).some((r) => r === "Investor" || r === "Retail Investor" || r === "Lender"));
    console.log(`${co.name}${t.rename ? ` -> ${t.rename}` : ""} (${co.domain ?? "no domain"}): roles ${JSON.stringify(roles)} -> ${JSON.stringify(next)}; ${peopleToFix.length} of ${co.contacts.length} people get Investor`);
    if (dry) continue;
    await prisma.company.update({ where: { id: co.id }, data: { roles: toJson(next), ...(t.rename ? { name: t.rename } : {}) } });
    for (const k of peopleToFix) await prisma.contact.update({ where: { id: k.id }, data: { roles: toJson([...parseList(k.roles), "Investor"]) } });
  }
  console.log(dry ? "dry run, nothing changed" : "done");
}
main().finally(() => prisma.$disconnect());
