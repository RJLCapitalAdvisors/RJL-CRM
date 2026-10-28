import { currentUser } from "@/lib/current-user";
import { brochureBytes, receiveBrochurePart } from "@/lib/outreach";

export const maxDuration = 60;

/**
 * The reach-out brochure (Jonathan, Oct 28, 2026). POST takes the file in parts from the Send page (a Vercel request carries at
 * most 4.5 MB; the brochure is 6 MB): ?part=0&parts=3&name=...&size=...&type=... with the bytes as the body. GET streams it
 * back for the preview eye on the Send page. Both are behind the sign-in gate.
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ ok: false, error: "Sign in with Microsoft first." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const part = Number(sp.get("part"));
  const parts = Number(sp.get("parts"));
  const size = Number(sp.get("size"));
  const name = sp.get("name") ?? "";
  const contentType = sp.get("type") ?? "application/pdf";
  if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 0 || parts < 1 || part >= parts || !(size > 0) || !name) return Response.json({ ok: false, error: "bad upload request" }, { status: 400 });
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const r = await receiveBrochurePart({ part, parts, name, size, contentType, bytes, by: me.email });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 240) }, { status: 500 });
  }
}

export async function GET() {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const b = await brochureBytes().catch(() => null);
  if (!b) return new Response("No brochure on file yet", { status: 404 });
  const inline = /pdf$/i.test(b.name) || /^image\//.test(b.contentType);
  return new Response(Buffer.from(b.bytes), { headers: { "Content-Type": /pdf$/i.test(b.name) ? "application/pdf" : b.contentType || "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${b.name.replace(/"/g, "")}"`, "Cache-Control": "private, no-store" } });
}
