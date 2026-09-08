import { buildFaqPdf } from "@/lib/faq-pdf";
import { verifyFileToken } from "@/lib/tokens";
import { currentUser } from "@/lib/current-user";

/** The deal's Investor FAQ as a PDF, built fresh from Questions answered. Signed-in users, or a signed link (for drag-out). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = new URL(req.url).searchParams.get("t");
  if (!(t && verifyFileToken(t) === `faq:${id}`) && !(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const pdf = await buildFaqPdf(id);
  if (!pdf) return new Response("No questions answered on this deal yet", { status: 404 });
  return new Response(Buffer.from(pdf.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.name}"`, "Content-Length": String(pdf.bytes.byteLength) } });
}
