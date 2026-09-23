import { buildProgressReportPdf } from "@/lib/progress-report-pdf";
import { streamBytes } from "@/lib/stream-file";
import { verifyFileToken } from "@/lib/tokens";
import { currentUser } from "@/lib/current-user";

/** The deal's progress report as a PDF, built fresh from the report as it stands. Signed-in users, or a signed link (for drag-out). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = new URL(req.url).searchParams.get("t");
  if (!(t && verifyFileToken(t) === `report:${id}`) && !(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const pdf = await buildProgressReportPdf(id);
  if (!pdf) return new Response("Not found", { status: 404 });
  return streamBytes(pdf.bytes, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.name}"`, "Content-Length": String(pdf.bytes.byteLength), "Cache-Control": "no-store" });
}
