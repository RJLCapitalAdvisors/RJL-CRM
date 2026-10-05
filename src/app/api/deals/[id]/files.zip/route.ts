import { zipSync } from "fflate";
import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { verifyFileToken } from "@/lib/tokens";
import { currentUser } from "@/lib/current-user";
import { fetchCloudFileByUrl } from "@/lib/cloud-links";
import { buildFaqPdf } from "@/lib/faq-pdf";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Download all (Jonathan, Oct 5, 2026): every file on the deal, the Investor FAQ included, in one zip to send an LP who
 * asks for the package. Files come from the mailbox they arrived in (or the link they came from), a portfolio's parts
 * contribute theirs, and two files with one name are told apart with a number. Behind the sign-in gate like the files.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = new URL(req.url).searchParams.get("t");
  if (!(t && verifyFileToken(t) === `zip:${id}`) && !(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const deal = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  if (!deal) return new Response("Not found", { status: 404 });
  const files = await prisma.dealFile.findMany({ where: { OR: [{ dealId: id }, { deal: { parentDealId: id } }] }, orderBy: { receivedAt: "asc" } });
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const taken = new Set<string>();
  const safe = (n: string) => n.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "file";
  const unique = (n: string) => {
    let name = safe(n), k = 2;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    while (taken.has(name.toLowerCase())) name = `${base} (${k++})${ext}`;
    taken.add(name.toLowerCase());
    return name;
  };
  const skipped: string[] = [];
  for (const f of files) {
    try {
      let bytes: Uint8Array | null = null;
      if (f.url) bytes = await fetchCloudFileByUrl(f.url, f.name);
      else bytes = new Uint8Array(await graph<ArrayBuffer>(`/users/${encodeURIComponent(f.mailbox)}/messages/${encodeURIComponent(f.graphId)}/attachments/${encodeURIComponent(f.attachmentId)}/$value`, { raw: true }));
      if (!bytes) { skipped.push(f.name); continue; }
      const already = /\.(pdf|xlsx|xlsm|pptx|docx|zip|png|jpe?g|gif|mp4)$/i.test(f.name); // these are compressed inside already
      entries[unique(f.name)] = [bytes, { level: already ? 0 : 6 }];
    } catch {
      skipped.push(f.name);
    }
  }
  const faq = await buildFaqPdf(id).catch(() => null);
  if (faq) entries[unique(faq.name)] = [faq.bytes, { level: 0 }];
  if (skipped.length) entries[unique("Files that could not be fetched.txt")] = [new TextEncoder().encode(`These files are on the ticket but could not be fetched for the zip:\n${skipped.join("\n")}\n`), { level: 6 }];
  if (!Object.keys(entries).length) return new Response("No files on this deal yet", { status: 404 });
  const zip = zipSync(entries);
  const name = `${safe(deal.propertyName ?? deal.name)} - files.zip`;
  return new Response(zip as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`, "Content-Length": String(zip.byteLength) } });
}
