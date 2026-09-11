import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 20 * 1024 * 1024;

/** The house's floorplan: stored on the row, served here. Same shape as the apartment route. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await prisma.ilHouse.findUnique({ where: { id }, select: { floorplan: true, floorplanType: true, floorplanName: true } });
  if (!h?.floorplan) return new NextResponse("No floorplan", { status: 404 });
  return new NextResponse(new Uint8Array(h.floorplan), {
    headers: {
      "content-type": h.floorplanType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${(h.floorplanName ?? "floorplan").replace(/"/g, "")}"`,
      "cache-control": "private, max-age=60",
    },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return new NextResponse("No file", { status: 400 });
  if (file.size > MAX) return new NextResponse("File is over 20 MB", { status: 413 });
  const type = file.type || "application/octet-stream";
  if (!type.startsWith("image/") && type !== "application/pdf") return new NextResponse("Use an image or a PDF", { status: 415 });
  const bytes = Buffer.from(await file.arrayBuffer());
  await prisma.ilHouse.update({ where: { id }, data: { floorplan: bytes, floorplanType: type, floorplanName: file.name } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.ilHouse.update({ where: { id }, data: { floorplan: null, floorplanType: null, floorplanName: null } });
  return NextResponse.json({ ok: true });
}
