import { NextResponse } from "next/server";
import { streamBytes } from "@/lib/stream-file";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 40 * 1024 * 1024;

/** The project brochure: stored on the row, served here. Same shape as the floorplan routes. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.ilProject.findUnique({ where: { id }, select: { brochure: true, brochureType: true, brochureName: true } });
  if (!p?.brochure) return new NextResponse("No brochure", { status: 404 });
  return streamBytes(p.brochure, {
      "content-type": p.brochureType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${(p.brochureName ?? "brochure").replace(/"/g, "")}"`,
      "cache-control": "private, max-age=60",
    });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return new NextResponse("No file", { status: 400 });
  if (file.size > MAX) return new NextResponse("File is over 40 MB", { status: 413 });
  const type = file.type || "application/octet-stream";
  if (!type.startsWith("image/") && type !== "application/pdf") return new NextResponse("Use a PDF or an image", { status: 415 });
  const bytes = Buffer.from(await file.arrayBuffer());
  await prisma.ilProject.update({ where: { id }, data: { brochure: bytes, brochureType: type, brochureName: file.name } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.ilProject.update({ where: { id }, data: { brochure: null, brochureType: null, brochureName: null } });
  return NextResponse.json({ ok: true });
}
