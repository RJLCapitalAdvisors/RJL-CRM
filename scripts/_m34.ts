import "dotenv/config";
import { prisma } from "../src/lib/db";
import { fetchCloudFiles } from "../src/lib/cloud-links";
import { stashFiles } from "../src/lib/file-store";

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Files recorded as bare links (the stash failed at the time) get pulled once more and kept in deals@ "CRM Files". */
(async () => {
  const linkFiles = await prisma.dealFile.findMany({ where: { mailbox: "link" }, include: { deal: { select: { name: true } } } });
  log("link-only files:", linkFiles.length);
  const byLink = new Map<string, typeof linkFiles>();
  for (const f of linkFiles) {
    const base = (f.url ?? "").replace(/#.*$/, "");
    byLink.set(base, [...(byLink.get(base) ?? []), f]);
  }
  for (const [link, files] of byLink) {
    if (!link) continue;
    log("pulling", link.slice(0, 80), "for", files.length, "files");
    const pulled = await fetchCloudFiles([link]);
    log("  pulled", pulled.files.length, "notes", pulled.notes.length);
    const stash = await stashFiles(pulled.files, files[0].deal.name.split(" | ")[0] + " data room").catch((e) => {
      log("  stash failed:", String(e).slice(0, 200));
      return null;
    });
    if (!stash) continue;
    let moved = 0;
    for (const f of files) {
      const att = stash.atts.find((a) => a.name.toLowerCase() === f.name.toLowerCase());
      if (!att) continue;
      await prisma.dealFile.update({ where: { id: f.id }, data: { mailbox: stash.mailbox, graphId: stash.graphId, attachmentId: att.id, size: att.size } }).catch(() => null);
      moved++;
    }
    log("  now kept in deals@:", moved, "of", files.length);
  }
  const deals = await prisma.deal.findMany({ where: { createdAt: { gte: new Date(Date.now() - 30 * 60_000) }, sponsorName: { contains: "Indicap", mode: "insensitive" } }, include: { files: { select: { name: true, mailbox: true } }, _count: { select: { facts: true } } } });
  for (const d of deals) log("ticket:", d.name, "|", d.city, d.state, "| files", d.files.length, `(${d.files.filter((f) => f.mailbox !== "link").length} in deals@)`, "| facts", d._count.facts);
  await prisma.$disconnect();
})();
