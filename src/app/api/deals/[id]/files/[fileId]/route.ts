import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";

/** Download one of a deal's attachments (streamed from the deals@ mailbox). Behind the sign-in gate like every /api route except inbound webhooks. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const f = await prisma.dealFile.findFirst({ where: { id: fileId, dealId: id } });
  if (!f) return new Response("Not found", { status: 404 });
  const bytes = await graph<ArrayBuffer>(`/users/${encodeURIComponent(f.mailbox)}/messages/${encodeURIComponent(f.graphId)}/attachments/${encodeURIComponent(f.attachmentId)}/$value`, { raw: true });
  return new Response(bytes, {
    headers: {
      "Content-Type": f.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${f.name.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
