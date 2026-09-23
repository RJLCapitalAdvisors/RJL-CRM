import { NextResponse } from "next/server";
import { streamBytes } from "@/lib/stream-file";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 20 * 1024 * 1024;

/** The apartment's floorplan: stored on the row, served here. Behind the sign-in gate like the rest of the CRM. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prisma.ilApartment.findUnique({ where: { id }, select: { floorplan: true, floorplanType: true, floorplanName: true } });
  if (!a?.floorplan) return new NextResponse("No floorplan", { status: 404 });
  return streamBytes(a.floorplan, {
      "content-type": a.floorplanType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${(a.floorplanName ?? "floorplan").replace(/"/g, "")}"`,
      "cache-control": "private, max-age=60",
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
  await prisma.ilApartment.update({ where: { id }, data: { floorplan: bytes, floorplanType: type, floorplanName: file.name } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.ilApartment.update({ where: { id }, data: { floorplan: null, floorplanType: null, floorplanName: null } });
  return NextResponse.json({ ok: true });
}
