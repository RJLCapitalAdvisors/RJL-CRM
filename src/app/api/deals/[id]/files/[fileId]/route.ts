import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { verifyFileToken } from "@/lib/tokens";
import { currentUser } from "@/lib/current-user";
import { fetchCloudFileByUrl } from "@/lib/cloud-links";

/** Download one of a deal's attachments (streamed from the deals@ mailbox). Behind the sign-in gate like every /api route except inbound webhooks. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const t = new URL(req.url).searchParams.get("t");
  if (!(t && verifyFileToken(t) === `file:${fileId}`) && !(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const f = await prisma.dealFile.findFirst({ where: { id: fileId, dealId: id } });
  if (!f) return new Response("Not found", { status: 404 });
  if (f.url) {
    const got = await fetchCloudFileByUrl(f.url, f.name);
    if (!got) return new Response("The link this file came from no longer opens", { status: 502 });
    return new Response(got as unknown as BodyInit, { headers: { "Content-Type": f.contentType ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${f.name.replace(/"/g, "")}"`, "Content-Length": String(got.byteLength) } });
  }
  const bytes = await graph<ArrayBuffer>(`/users/${encodeURIComponent(f.mailbox)}/messages/${encodeURIComponent(f.graphId)}/attachments/${encodeURIComponent(f.attachmentId)}/$value`, { raw: true });
  return new Response(bytes, {
    headers: {
      "Content-Type": f.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${f.name.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
