import { prisma } from "../src/lib/db";
import { engagementGroups, finalizeEngagement } from "../src/lib/send-deal";
import { lineMatchesGroup } from "../src/lib/engagement-reply";
import { logActivity } from "../src/lib/activity";

const PREF = "cmvk0az1l0001ujrsmhf39pdf"; // Citivest | Hedges Greene (Pref Equity)
const AT = "2026-10-24T00:17:54.000Z"; // Kyle Corrigan's "Revised list for Tier 2"
const TIER1 = ["BIG Equity", "Calibogue Capital", "Midloch LLC"]; // Jonathan's Oct 23 email: already approached, revisited for pref; Kyle did not revise this tier
const TIER2 = ["Abod Capital", "ARCTRUST", "Artisan Capital", "BattleCreek Capital", "Calmwater Asset Management LL", "International Capital LLC", "Leste USA LLC", "Machine Investment Group", "Morrison Street Capital LLC", "NLA Capital Partners", "Peachtree Group", "Siguler Guff", "Sound Mark Partners", "Stonehill", "Triangle Capital Group", "Wellings Capital"];

async function main() {
  const dry = process.argv.includes("--dry");
  const groups = await engagementGroups(PREF);
  const want = [...TIER1, ...TIER2];
  const keep = groups.filter((g) => want.some((w) => lineMatchesGroup(w, g)));
  const drop = groups.filter((g) => !keep.includes(g));
  const unmatched = want.filter((w) => !groups.some((g) => lineMatchesGroup(w, g)));
  console.log("on the ticket:", groups.length, "| keep:", keep.map((g) => g.name).join(", "));
  console.log("drop:", drop.map((g) => g.name).join(", "));
  console.log("on Kyle's list but not on the ticket:", unmatched);
  if (dry) return console.log("dry run");
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: PREF }, select: { details: true } });
  const det = JSON.parse(deal.details || "{}") as Record<string, unknown>;
  const struck = drop.map((g) => ({ name: g.name, companyId: g.companyId || null, how: "left out", at: AT, by: "Kyle Corrigan" }));
  await prisma.deal.update({ where: { id: PREF }, data: { details: JSON.stringify({ ...det, engagementStruck: struck, engagementConfirmedAt: AT, engagementConfirmedBy: "Kyle Corrigan" }) } });
  const res = await finalizeEngagement(PREF, keep.map((g) => g.companyId!).filter(Boolean), [], { markSigned: false });
  console.log("finalize:", res);
  await logActivity({ type: "NOTE", body: `Kyle Corrigan's revised Tier 2 list (Oct 24) applied: Tier 1 (${TIER1.join(", ")}) stays as proposed on Oct 23; Tier 2 is now the 16 groups he wrote out, so these came off: ${drop.map((g) => g.name).join(", ")}. Applied by hand on Oct 26; the reply reader had skipped the email.`, dealId: PREF, occurredAt: new Date() });
  console.log("after:", (await engagementGroups(PREF)).map((g) => g.name).join(", "));
}
main().finally(() => prisma.$disconnect());
