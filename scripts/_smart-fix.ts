import { prisma } from "../src/lib/db";
import { engagementGroups, finalizeEngagement } from "../src/lib/send-deal";
import { logActivity } from "../src/lib/activity";

const DEAL = "cmvjv9by3001nia08eizdf246"; // ZMR Capital | Smart Living Allen Genoa
const AT = "2026-10-26T16:36:32.000Z"; // Zamir's list
// Zamir Kazi, Oct 26: "These are the groups we don't know and haven't received the package", then "OK to send to the 11 groups i mentioned"
const KEEP: RegExp[] = [/^abod/i, /^aureon/i, /^calibogue/i, /^corten/i, /^jw capital/i, /^lakerock/i, /^monocle/i, /^nca realty/i, /^recap/i, /^triangle capital/i, /^viking/i];

async function main() {
  const dry = process.argv.includes("--dry");
  const groups = await engagementGroups(DEAL);
  const keep = groups.filter((g) => KEEP.some((re) => re.test(g.name)));
  const drop = groups.filter((g) => !keep.includes(g));
  console.log(`groups ${groups.length} | keep ${keep.length}: ${keep.map((g) => g.name).join(", ")}`);
  console.log(`drop ${drop.length}: ${drop.map((g) => g.name).join(", ")}`);
  if (keep.length !== 11) throw new Error("expected eleven matches");
  const launches = await prisma.dealLaunch.count({ where: { dealId: DEAL, status: { in: ["QUEUED", "SENDING", "SENT"] } } });
  console.log("launch rows queued or sent:", launches, "| rows past Deal Not Sent:", drop.filter((g) => g.status > 1).map((g) => g.name));
  if (dry) return console.log("dry run");
  const d = await prisma.deal.findUniqueOrThrow({ where: { id: DEAL }, select: { details: true } });
  const det = JSON.parse(d.details || "{}") as Record<string, unknown>;
  const struck = drop.map((g) => ({ name: g.name, companyId: g.companyId || null, how: "left out", at: AT, by: "Zamir Kazi" }));
  await prisma.deal.update({ where: { id: DEAL }, data: { details: JSON.stringify({ ...det, engagementStruck: struck }) } });
  console.log("finalize:", await finalizeEngagement(DEAL, keep.map((g) => g.companyId), [], { markSigned: false }));
  await logActivity({ type: "NOTE", body: `Zamir Kazi's list (Oct 26) applied: RJL may go only to the 11 groups ZMR does not know and that have not had the package (${keep.map((g) => g.name).join(", ")}); the terms do not apply to the rest, so these came off: ${drop.map((g) => g.name).join(", ")}. Applied by hand on Oct 26; the reply reader had missed the list.`, dealId: DEAL, occurredAt: new Date() });
}
main().finally(() => prisma.$disconnect());
