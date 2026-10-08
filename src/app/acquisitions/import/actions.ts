"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { answerProperty, saveOverride } from "@/lib/aq-import-runs";
import type { Override } from "@/lib/aq-import-build";

async function guard() {
  const u = await currentUser();
  if (u && !u.workspaces.includes("AQ")) throw new Error("Open RJL Acquisitions first.");
}

/** Shawn's change to one property on the review page (null puts Claude's reading back). */
export async function setImportOverride(id: string, key: string, o: Override | null) {
  await guard();
  await saveOverride(id, key, o);
  revalidatePath(`/acquisitions/import/${id}`);
}

/** Shawn's own words on one property: Claude reads it again with them as the instruction. */
export async function answerImportProperty(id: string, key: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  await guard();
  try {
    const r = await answerProperty(id, key, text);
    if (!r.ok) return r;
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 300) };
  }
  revalidatePath(`/acquisitions/import/${id}`);
  return { ok: true };
}

/** Drop an import that was never written (nothing in the CRM changes). */
export async function deleteImportRun(id: string) {
  await guard();
  await prisma.aqImportRun.deleteMany({ where: { id, status: { in: ["READING", "REVIEW", "FAILED"] } } });
  revalidatePath("/acquisitions/import");
}
