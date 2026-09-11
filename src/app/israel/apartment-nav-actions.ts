"use server";

import { prisma } from "@/lib/db";
import { apartmentLine, houseLine } from "@/lib/israel";

/** Name and one-line description of an apartment or a house for the sidebar widget. */
export async function unitNavInfo(section: "apartments" | "houses", id: string): Promise<{ id: string; name: string; line: string } | null> {
  if (section === "houses") {
    const h = await prisma.ilHouse.findUnique({ where: { id }, select: { id: true, name: true, city: true, neighborhood: true, street: true, rooms: true, internalSqm: true, migrashSqm: true, floors: true, priceNis: true } });
    return h ? { id: h.id, name: h.name, line: houseLine(h) } : null;
  }
  const a = await prisma.ilApartment.findUnique({ where: { id }, select: { id: true, name: true, city: true, neighborhood: true, street: true, rooms: true, internalSqm: true, mirpesetSqm: true, priceNis: true, floor: true } });
  return a ? { id: a.id, name: a.name, line: apartmentLine(a) } : null;
}

