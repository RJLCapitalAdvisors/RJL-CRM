"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { saveOverride } from "@/lib/aq-import-runs";
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

/** Drop an import that was never written (nothing in the CRM changes). */
export async function deleteImportRun(id: string) {
  await guard();
  await prisma.aqImportRun.deleteMany({ where: { id, status: { in: ["READING", "REVIEW", "FAILED"] } } });
  revalidatePath("/acquisitions/import");
}
