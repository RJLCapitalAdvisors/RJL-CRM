import { NextResponse } from "next/server";
import { readStep } from "@/lib/aq-import-runs";
import { aqUser } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One reading step (the CRM context, then a few Claude batches at once). The page calls it until the run is ready for review. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await aqUser()).ok) return NextResponse.json({ error: "Open RJL Acquisitions first." }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json(await readStep(id));
  } catch (e) {
    console.error("aq import read step failed", e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  }
}
