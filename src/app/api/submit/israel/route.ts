import { NextResponse } from "next/server";
import { submitIsraelForm, type SubmitKind } from "@/lib/israel-submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The public submission forms post here (a route handler, so the pictures and PDFs are not held to a server action's body limit). */
export async function POST(req: Request) {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, missing: [], error: "The form could not be read. Please try again." }, { status: 400 });
  }
  const kind = String(fd.get("kind") ?? "");
  if (!["apartment", "house", "project"].includes(kind)) return NextResponse.json({ ok: false, missing: [], error: "Unknown form." }, { status: 400 });
  try {
    const r = await submitIsraelForm(kind as SubmitKind, fd);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    console.error("israel submission failed", e);
    return NextResponse.json({ ok: false, missing: [], error: "Something went wrong saving the submission. Please try again or email us." }, { status: 500 });
  }
}
