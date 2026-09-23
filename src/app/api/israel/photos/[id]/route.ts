import { NextResponse } from "next/server";
import { streamBytes } from "@/lib/stream-file";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One picture of a unit or project, served from the row; DELETE removes it. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.ilPhoto.findUnique({ where: { id } });
  if (!p) return new NextResponse("No picture", { status: 404 });
  return streamBytes(p.bytes, { "content-type": p.type, "content-disposition": `inline; filename="${p.name.replace(/"/g, "")}"`, "cache-control": "private, max-age=3600" });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.ilPhoto.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
