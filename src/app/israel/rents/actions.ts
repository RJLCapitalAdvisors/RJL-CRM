"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { forgetRentTable } from "@/lib/il-rents";
import type { SaveResult } from "@/components/data-grid";

/** One rent typed on The Rents page: a whole number of shekels a month, or blank to clear it. */
export async function setRentAction(rentId: string, key: string, value: string | null): Promise<SaveResult> {
  if (key !== "rentNis") return { ok: false, reason: "Only the rent is typed here." };
  const raw = (value ?? "").replace(/[^0-9.]/g, "");
  const n = raw ? Math.round(Number(raw)) : null;
  if (raw && (!Number.isFinite(n) || n! < 0 || n! > 200_000)) return { ok: false, reason: "A monthly rent in shekels, e.g. 7500." };
  const me = await currentUser();
  await prisma.ilRent.update({ where: { id: rentId }, data: { rentNis: n, updatedBy: me?.email ?? null } });
  forgetRentTable();
  revalidatePath("/israel/rents");
  return { ok: true, row: { rentNis: n == null ? "" : String(n) } };
}
