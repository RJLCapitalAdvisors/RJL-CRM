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
  const sp = new URL(req.url).searchParams;
  const lower = f.name.toLowerCase();
  // ?preview=1: see the file in the browser before sending it (Jonathan, Oct 1, 2026). PDFs and pictures open inline; a
  // spreadsheet, a Word file or a deck is shown as a page of its text and tables.
  if (sp.get("preview") === "1") {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const page = (body: string) => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.name)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:13px;margin:16px;color:#222}h1{font-size:15px;margin:0 0 12px}h2{font-size:13px;margin:18px 0 6px;color:#555}table{border-collapse:collapse;margin-bottom:12px}td,th{border:1px solid #ddd;padding:2px 6px;white-space:nowrap;font-size:12px}pre{white-space:pre-wrap;font-family:inherit}</style></head><body><h1>${esc(f.name)}</h1>${body}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (/\.(xlsx|xlsm|xls|csv)$/.test(lower)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true });
      const parts = wb.SheetNames.slice(0, 8).map((n) => `<h2>${esc(n)}</h2>${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: "", footer: "" })}`);
      return page(parts.join("") || "<p>(empty workbook)</p>");
    }
    if (/\.(pptx|docx)$/.test(lower)) {
      const { pptxToText, docxToText } = await import("@/lib/office-text");
      const text = lower.endsWith(".pptx") ? pptxToText(new Uint8Array(bytes)) : docxToText(new Uint8Array(bytes));
      return page(`<pre>${esc(text || "(no text in this file)")}</pre>`);
    }
  }
  const inline = sp.get("preview") === "1" || sp.get("inline") === "1";
  return new Response(bytes, {
    headers: {
      "Content-Type": f.contentType ?? "application/octet-stream",
      "Content-Disposition": `${inline && (/\.(pdf|png|jpe?g|gif|webp|txt)$/.test(lower) || /pdf|image/.test(f.contentType ?? "")) ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
