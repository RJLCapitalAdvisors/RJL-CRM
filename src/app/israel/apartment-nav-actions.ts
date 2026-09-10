"use server";

import { prisma } from "@/lib/db";
import { apartmentLine } from "@/lib/israel";

/** Name and one-line description of an apartment for the sidebar widget. */
export async function apartmentNavInfo(id: string): Promise<{ id: string; name: string; line: string } | null> {
  const a = await prisma.ilApartment.findUnique({ where: { id }, select: { id: true, name: true, city: true, neighborhood: true, street: true, rooms: true, internalSqm: true, mirpesetSqm: true, priceNis: true, floor: true } });
  return a ? { id: a.id, name: a.name, line: apartmentLine(a) } : null;
}
