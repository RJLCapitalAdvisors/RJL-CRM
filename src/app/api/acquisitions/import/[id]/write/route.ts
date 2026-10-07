import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { importStep } from "@/lib/aq-import-runs";
import { aqUser } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One import step: the next dozen properties written. `from` is where the page thinks the run stands (a double click writes nothing twice). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await aqUser()).ok) return NextResponse.json({ error: "Open RJL Acquisitions first." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { from?: number };
  try {
    const r = await importStep(id, Number(body.from ?? 0));
    if (r.status === "DONE") for (const p of ["/acquisitions", "/acquisitions/properties", "/acquisitions/companies", "/acquisitions/contacts", "/acquisitions/pipeline", "/acquisitions/deals", "/acquisitions/junk/properties", "/acquisitions/junk/phones"]) revalidatePath(p);
    return NextResponse.json(r);
  } catch (e) {
    console.error("aq import write step failed", e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  }
}
