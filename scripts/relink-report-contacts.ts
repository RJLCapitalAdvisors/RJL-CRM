/** Point each progress-report row at the person the deal email was actually sent to (from Sent Items). Dry run unless --apply. */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { graph } from "../src/lib/graph";
import { ACTIVE_STAGES } from "../src/lib/taxonomy";
const APPLY = process.argv.includes("--apply");
const MAILBOXES = ["jonathan@rjlcapadvisors.com", "aviel@rjlcapadvisors.com", "nikko@rjlcapadvisors.com"];
type M = { id: string; subject: string | null; sentDateTime?: string; toRecipients?: { emailAddress: { address: string; name?: string } }[]; ccRecipients?: { emailAddress: { address: string; name?: string } }[] };
(async () => {
  const rows = await prisma.dealInvestor.findMany({ where: { status: { gte: 2 }, deal: { stage: { in: [...ACTIVE_STAGES] } } }, include: { contact: { include: { company: true } }, deal: true } });
  let changed = 0, unknown = 0;
  for (const r of rows) {
    const dom = r.contact.company?.domain ?? (r.contact.email?.split("@")[1] ?? null);
    if (!dom) { unknown++; continue; }
    const words = [r.deal.propertyName ?? r.deal.name, r.deal.city ?? ""].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["recap", "portfolio", "capital", "intros"].includes(w) || w === "intros");
    const kw = dom.split(".")[0];
    let hit: M | null = null;
    for (const mb of MAILBOXES) {
      try {
        const res = await graph<{ value: M[] }>(`/users/${encodeURIComponent(mb)}/mailFolders/sentitems/messages?$search=${encodeURIComponent(`"participants:${kw}"`)}&$top=25&$select=id,subject,sentDateTime,toRecipients,ccRecipients`);
        const atDom = res.value.filter((m) => [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].some((p) => p.emailAddress.address.toLowerCase().endsWith("@" + dom)));
        const cands = atDom.filter((m) => words.some((w) => (m.subject ?? "").toLowerCase().includes(w))).sort((a, b) => (a.sentDateTime ?? "").localeCompare(b.sentDateTime ?? ""));
        if (cands[0]) { hit = cands[0]; break; } // earliest = the original send
        // no subject match: the most recent thread with the firm on or before the report's date
        const before = atDom.filter((m) => (m.sentDateTime ?? "") <= new Date(r.updatedAt.getTime() + 86_400_000).toISOString()).sort((a, b) => (b.sentDateTime ?? "").localeCompare(a.sentDateTime ?? ""));
        // keep the listed person if we have written to them at all; only replace someone we never emailed
        const wroteToListed = atDom.some((m) => [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].some((p) => p.emailAddress.address.toLowerCase() === (r.contact.email ?? "").toLowerCase()));
        if (before[0] && !hit && !wroteToListed) hit = before[0];
      } catch {}
    }
    if (!hit) { unknown++; continue; }
    const tos = (hit.toRecipients ?? []).map((p) => p.emailAddress).filter((p) => p.address.toLowerCase().endsWith("@" + dom));
    const primary = tos.find((p) => !/^(deals?|info|investments?|acquisitions?|team|office)@/i.test(p.address)) ?? tos[0];
    if (!primary) { unknown++; continue; }
    const addr = primary.address.toLowerCase();
    if (r.contact.email?.toLowerCase() === addr) continue;
    console.log(`${(r.deal.propertyName ?? r.deal.name).slice(0, 28).padEnd(28)} ${(r.contact.company?.name ?? "").slice(0, 26).padEnd(26)} ${(r.contact.email ?? "(none)").padEnd(38)} -> ${addr}${primary.name ? ` (${primary.name})` : ""}`);
    if (!APPLY) { changed++; continue; }
    let contact = await prisma.contact.findUnique({ where: { email: addr } });
    if (!contact) {
      const raw = (primary.name ?? "").replace(/"/g, "").trim();
      const [first, ...rest] = raw.includes(",") ? [raw.split(",")[1].trim(), raw.split(",")[0].trim()] : raw.split(/\s+/);
      contact = await prisma.contact.create({ data: { email: addr, firstName: first || null, lastName: rest.join(" ") || null, companyId: r.contact.companyId, roles: r.contact.company?.roles ?? "[]" } });
    } else if (!contact.companyId && r.contact.companyId) await prisma.contact.update({ where: { id: contact.id }, data: { companyId: r.contact.companyId } });
    const clash = await prisma.dealInvestor.findFirst({ where: { dealId: r.dealId, contactId: contact.id } });
    if (clash) await prisma.dealInvestor.delete({ where: { id: r.id } });
    else await prisma.dealInvestor.update({ where: { id: r.id }, data: { contactId: contact.id, updatedAt: r.updatedAt } });
    changed++;
  }
  console.log(`${APPLY ? "changed" : "would change"} ${changed} of ${rows.length}; no matching sent email for ${unknown}`);
  await prisma.$disconnect();
})();
