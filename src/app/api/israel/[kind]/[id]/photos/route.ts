import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 15 * 1024 * 1024;

/** Pictures added to an apartment, a house or a project: several files in one upload. */
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!["apartments", "houses", "projects"].includes(kind)) return new NextResponse("Unknown kind", { status: 404 });
  const fd = await req.formData();
  const files = fd.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return new NextResponse("No files", { status: 400 });
  const link = kind === "apartments" ? { apartmentId: id } : kind === "houses" ? { houseId: id } : { projectId: id };
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    if (f.size > MAX) return new NextResponse(`${f.name} is over 15 MB`, { status: 413 });
    await prisma.ilPhoto.create({ data: { ...link, name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) } });
    n++;
  }
  return NextResponse.json({ ok: true, added: n });
}
