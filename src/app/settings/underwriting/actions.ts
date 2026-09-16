"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { SETTING_KEY } from "@/lib/underwriting-rules";

/** Saves the rules window; the next deals@ email is read with these. */
export async function saveUnderwritingRules(fd: FormData) {
  const v = fd.get("text");
  const text = typeof v === "string" ? v.replace(/\r\n/g, "\n") : "";
  await prisma.setting.upsert({ where: { key: SETTING_KEY }, update: { value: text }, create: { key: SETTING_KEY, value: text } });
  revalidatePath("/settings/underwriting");
}
