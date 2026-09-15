"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

/** "Not active": the report leaves the Active progress reports page (and the reports-due list) until an investor row on the deal changes again. */
export async function markReportInactive(dealId: string) {
  await prisma.deal.update({ where: { id: dealId }, data: { reportInactiveAt: new Date() } });
  revalidatePath("/reports");
  revalidatePath("/");
}
