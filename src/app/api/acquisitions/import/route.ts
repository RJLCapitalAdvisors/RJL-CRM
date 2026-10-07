import { NextResponse } from "next/server";
import { createRun } from "@/lib/aq-import-runs";
import { aqUser } from "./guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The Import section's upload: the file is parsed whole by code into an AqImportRun (a route handler, so a big export is not held to a server action's body limit). */
export async function POST(req: Request) {
  const who = await aqUser();
  if (!who.ok) return NextResponse.json({ error: "Open RJL Acquisitions first." }, { status: 403 });
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "The file could not be read." }, { status: 400 });
  }
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a file first." }, { status: 400 });
  if (!/\.(csv|tsv|txt|xlsx|xls|xlsm)$/i.test(file.name)) return NextResponse.json({ error: "Use a .csv or .xlsx file." }, { status: 400 });
  try {
    const r = await createRun(file.name, Buffer.from(await file.arrayBuffer()), who.name);
    return "error" in r ? NextResponse.json({ error: r.error }, { status: 422 }) : NextResponse.json(r);
  } catch (e) {
    console.error("aq import upload failed", e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  }
}
