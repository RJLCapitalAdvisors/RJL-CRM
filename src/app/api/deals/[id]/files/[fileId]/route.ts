import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { verifyFileToken } from "@/lib/tokens";
import { currentUser } from "@/lib/current-user";
import { fetchCloudFileByUrl } from "@/lib/cloud-links";

/** The browser's own type for a file, from its name: a PDF served as octet-stream downloads instead of showing (Oct 1, 2026). */
function typeFor(name: string, fallback: string | null): string {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "") as string;
  const known: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", html: "text/html; charset=utf-8" };
  return known[ext] ?? (fallback && fallback !== "application/octet-stream" ? fallback : "application/octet-stream");
}
const VIEWABLE = /\.(pdf|png|jpe?g|gif|webp|txt)$/i;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One of a deal's attachments, streamed from the mailbox it arrived in (or re-fetched from the cloud link it came from).
 * Behind the sign-in gate like every /api route except inbound webhooks. `?preview=1` is a look without a download
 * (Jonathan, Oct 1, 2026): PDFs and pictures show in the tab; a spreadsheet, Word file or deck becomes a page of its
 * text and tables; anything else explains itself instead of downloading. Without it the file downloads as before.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const sp = new URL(req.url).searchParams;
  const t = sp.get("t");
  if (!(t && verifyFileToken(t) === `file:${fileId}`) && !(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const f = await prisma.dealFile.findFirst({ where: { id: fileId, dealId: id } });
  if (!f) return new Response("Not found", { status: 404 });
  let bytes: ArrayBuffer;
  if (f.url) {
    const got = await fetchCloudFileByUrl(f.url, f.name);
    if (!got) return new Response("The link this file came from no longer opens", { status: 502 });
    bytes = got instanceof ArrayBuffer ? got : (got as Uint8Array).buffer.slice((got as Uint8Array).byteOffset, (got as Uint8Array).byteOffset + (got as Uint8Array).byteLength) as ArrayBuffer;
  } else {
    bytes = await graph<ArrayBuffer>(`/users/${encodeURIComponent(f.mailbox)}/messages/${encodeURIComponent(f.graphId)}/attachments/${encodeURIComponent(f.attachmentId)}/$value`, { raw: true });
  }
  const lower = f.name.toLowerCase();
  const preview = sp.get("preview") === "1";
  if (preview) {
    const page = (body: string) => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.name)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:13px;margin:16px;color:#222}h1{font-size:15px;margin:0 0 12px}h2{font-size:13px;margin:18px 0 6px;color:#555}table{border-collapse:collapse;margin-bottom:12px}td,th{border:1px solid #ddd;padding:2px 6px;white-space:nowrap;font-size:12px}pre{white-space:pre-wrap;font-family:inherit}</style></head><body><h1>${esc(f.name)}</h1>${body}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=300" } });
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
    if (!VIEWABLE.test(lower)) return page(`<p>This kind of file (${esc(lower.split(".").pop() ?? "file")}) cannot be shown in the browser. ${Math.round(bytes.byteLength / 1024)} KB. <a href="${esc(new URL(req.url).pathname)}?t=${esc(t ?? "")}">Download it</a> to open it in its own program.</p>`);
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": preview ? typeFor(f.name, f.contentType) : f.contentType ?? "application/octet-stream",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
      ...(preview ? { "Cache-Control": "private, max-age=300" } : {}),
    },
  });
}
