import { prisma } from "../src/lib/db";
import { engagementGroups, finalizeEngagement } from "../src/lib/send-deal";
import { logActivity } from "../src/lib/activity";

const DEAL = "cmvjs23nn0003jv08f207rc73"; // Four Corners | The Waters at Millerville
const AT = "2026-10-22T20:58:14.000Z"; // Jason Wisotsky's reply to the engagement letter
// Jason's list, minus SilverCap and Olympus (kept on Jonathan's say-so, Oct 23 and Oct 26)
const STRIKE = [/^trigate/i, /^jw capital/i, /^artemis/i, /^equity resource/i, /^tryperion/i, /^dome/i, /^h\.?i\.?g\.?\b/i, /^red starr/i, /^jefferson river/i];

async function main() {
  const dry = process.argv.includes("--dry");
  const groups = await engagementGroups(DEAL);
  const hit = groups.filter((g) => STRIKE.some((re) => re.test(g.name)));
  const missed = STRIKE.filter((re) => !groups.some((g) => re.test(g.name))).map(String);
  console.log("groups on the letter:", groups.length, "| to strike:", hit.map((g) => `${g.name} (${g.rowIds.length} rows)`), "| not on the list any more:", missed);
  const rowIds = hit.flatMap((g) => g.rowIds);
  const launches = await prisma.dealLaunch.findMany({ where: { dealId: DEAL, rowId: { in: rowIds } }, select: { id: true, rowId: true, status: true, sentAt: true } });
  console.log("launches on those rows:", launches);
  const sent = launches.filter((l) => l.sentAt || l.status === "SENT");
  if (sent.length) console.log("WARNING: some of these were already sent:", sent);
  console.log("\nrecent notes on the ticket:");
  for (const n of await prisma.activity.findMany({ where: { dealId: DEAL, type: "NOTE", occurredAt: { gte: new Date("2026-10-22") } }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true, body: true } })) console.log(`  ${n.occurredAt.toISOString()} ${(n.body ?? "").slice(0, 200)}`);
  if (dry) return console.log("\ndry run, nothing changed");

  // 1) record the strike on the ticket's engagement card, as the reply reader would have
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: DEAL }, select: { details: true } });
  const det = JSON.parse(deal.details || "{}") as Record<string, unknown>;
  const earlier = ((det.engagementStruck as { name: string }[] | undefined) ?? []).filter((s) => !hit.some((g) => g.name === s.name));
  const struck = hit.map((g) => ({ name: g.name, companyId: g.companyId || null, how: "asked", at: AT, by: "Jason Wisotsky" }));
  await prisma.deal.update({ where: { id: DEAL }, data: { details: JSON.stringify({ ...det, engagementStruck: [...earlier, ...struck] }) } });
  // 2) off the agreed list and the progress report
  const keep = groups.filter((g) => g.companyId && !hit.includes(g)).map((g) => g.companyId!);
  const res = await finalizeEngagement(DEAL, keep, [], { markSigned: false });
  console.log("finalize:", res);
  // 3) nothing queued goes out to them
  const unsent = launches.filter((l) => !l.sentAt && l.status !== "SENT").map((l) => l.id);
  if (unsent.length) console.log("queued launches removed:", (await prisma.dealLaunch.deleteMany({ where: { id: { in: unsent } } })).count);
  await logActivity({ type: "NOTE", body: `Jason Wisotsky's reply to the engagement letter (Oct 22) took these groups off the list: ${hit.map((g) => g.name).join(", ")}. SilverCap Partners and Olympus Property stay on (Jonathan, Oct 23). Applied by hand on Oct 26 because the reply reader had not caught it.`, dealId: DEAL, occurredAt: new Date() });
  console.log("after:", (await engagementGroups(DEAL)).length, "groups agreed");
}
main().finally(() => prisma.$disconnect());
