"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { CURVE_SETTING_KEY } from "@/lib/index-rates";

/** Saves the pasted SOFR forward curve; the next deal email render prices floating loans off it. */
export async function saveForwardCurve(fd: FormData) {
  const v = fd.get("text");
  const text = typeof v === "string" ? v.replace(/\r\n/g, "\n") : "";
  await prisma.setting.upsert({ where: { key: CURVE_SETTING_KEY }, update: { value: text }, create: { key: CURVE_SETTING_KEY, value: text } });
  revalidatePath("/settings/rates");
}
