import { PrismaClient } from "@prisma/client";
/**
 * Move RJL Acquisitions to its own database (Jonathan, Oct 7, 2026): copy everything the Acquisitions side owns from
 * the shared database to Shawn's. Run with both connection strings and the target already pushed to the schema:
 *
 *   SOURCE_DATABASE_URL=postgres://... TARGET_DATABASE_URL=postgres://... node --import tsx scripts/migrate-acquisitions.ts [--dry]
 *
 * Copies, in dependency order, skipping rows the target already has (so it can be run again before the cutover):
 *   Users with Acquisitions access (workspaces or granted carry AQ), the AQ settings (pipeline stages, data rules,
 *   import instructions, bounce scans), the Aq* tables (companies, contacts, properties, their links, notes, transcripts,
 *   activities, junk numbers, held imports), and the Ask the CRM threads of workspace AQ. Nothing is deleted anywhere.
 */
const src = new PrismaClient({ datasourceUrl: process.env.SOURCE_DATABASE_URL });
const dst = new PrismaClient({ datasourceUrl: process.env.TARGET_DATABASE_URL });
const dry = process.argv.includes("--dry");
const CHUNK = 500;

async function copy<T extends { id?: string } | Record<string, unknown>>(label: string, rows: T[], write: (batch: T[]) => Promise<{ count: number }>) {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    if (!dry) n += (await write(batch)).count;
  }
  console.log(`${label}: ${rows.length} in the source, ${dry ? "would copy" : `${n} copied`}`);
}

async function main() {
  if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) throw new Error("set SOURCE_DATABASE_URL and TARGET_DATABASE_URL");
  // people: anyone with AQ in their access or granted list (Shawn; Jonathan too, so he can still open it while it settles)
  const users = (await src.user.findMany()).filter((u) => /"AQ"/.test(u.workspaces ?? "") || /"AQ"/.test((u as { granted?: string | null }).granted ?? ""));
  await copy("users", users, (b) => dst.user.createMany({ data: b, skipDuplicates: true }));
  const settings = await src.setting.findMany({ where: { OR: [{ key: { in: ["aqBuyerStages", "aqOperatorStages", "aqDealStages", "dataRules:AQ", "importInstructions:AQ"] } }, { key: { startsWith: "bounceScan:" } }] } });
  await copy("settings", settings, (b) => dst.setting.createMany({ data: b, skipDuplicates: true }));
  await copy("companies", await src.aqCompany.findMany(), (b) => dst.aqCompany.createMany({ data: b, skipDuplicates: true }));
  await copy("contacts", await src.aqContact.findMany(), (b) => dst.aqContact.createMany({ data: b, skipDuplicates: true }));
  await copy("properties", await src.aqProperty.findMany(), (b) => dst.aqProperty.createMany({ data: b, skipDuplicates: true }));
  await copy("property-company links", await src.aqPropertyCompany.findMany(), (b) => dst.aqPropertyCompany.createMany({ data: b, skipDuplicates: true }));
  await copy("property-contact links", await src.aqPropertyContact.findMany(), (b) => dst.aqPropertyContact.createMany({ data: b, skipDuplicates: true }));
  await copy("notes", await src.aqNote.findMany(), (b) => dst.aqNote.createMany({ data: b, skipDuplicates: true }));
  await copy("transcripts", await src.aqTranscript.findMany(), (b) => dst.aqTranscript.createMany({ data: b, skipDuplicates: true }));
  await copy("activities (emails)", await src.aqActivity.findMany(), (b) => dst.aqActivity.createMany({ data: b, skipDuplicates: true }));
  await copy("junk numbers", await src.aqJunkPhone.findMany(), (b) => dst.aqJunkPhone.createMany({ data: b, skipDuplicates: true }));
  await copy("held imports", await src.aqPendingImport.findMany(), (b) => dst.aqPendingImport.createMany({ data: b, skipDuplicates: true }));
  const threads = await src.chatThread.findMany({ where: { workspace: "AQ" } });
  await copy("Ask the CRM threads", threads, (b) => dst.chatThread.createMany({ data: b, skipDuplicates: true }));
  const messages = threads.length ? await src.chatMessage.findMany({ where: { threadId: { in: threads.map((t) => t.id) } } }) : [];
  await copy("Ask the CRM messages", messages, (b) => dst.chatMessage.createMany({ data: b, skipDuplicates: true }));
  console.log(dry ? "dry run: nothing written" : "done: Acquisitions data is in the target database");
}
main()
  .catch((e) => {
    console.error("FAILED", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await src.$disconnect();
    await dst.$disconnect();
  });
