import { prisma } from "@/lib/db";

/**
 * What the project knows about its building fills the apartments and houses filed under it (Jonathan, Sep 17): total
 * units and total stories on every apartment, delivery on apartments and houses. Only blanks are filled; a unit's own
 * value, typed or extracted, stays. Called after a project is saved by hand and after the intake touches one (Sep 23,
 * 2026: the Mophet website gave 176 units and 7 floors; the 19 unit tickets under it take them).
 */
export async function syncProjectToUnits(projectId: string) {
  const p = await prisma.ilProject.findUnique({ where: { id: projectId }, select: { totalUnits: true, stories: true, completionDate: true, developerId: true, developerIds: true, street: true, city: true, neighborhood: true } });
  if (!p) return;
  // the address (Jonathan, Sep 23, 2026): a unit with no street, or a street without a house number, takes the project's; blank city and neighborhood are filled
  for (const model of ["ilApartment", "ilHouse"] as const) {
    const m = prisma[model] as unknown as { findMany: (a: unknown) => Promise<{ id: string; street: string | null; city: string | null; neighborhood: string | null }[]>; update: (a: unknown) => Promise<unknown> };
    const units = await m.findMany({ where: { projectId }, select: { id: true, street: true, city: true, neighborhood: true } });
    for (const u of units) {
      const data: Record<string, string> = {};
      if (p.street && (!u.street || (!/\d/.test(u.street) && /\d/.test(p.street)))) data.street = p.street;
      if (p.city && !u.city) data.city = p.city;
      if (p.neighborhood && !u.neighborhood) data.neighborhood = p.neighborhood;
      if (Object.keys(data).length) await m.update({ where: { id: u.id }, data: { ...data, geoQuery: null } }); // the pin is looked up again
    }
  }
  if (p.totalUnits != null) await prisma.ilApartment.updateMany({ where: { projectId, buildingUnits: null }, data: { buildingUnits: p.totalUnits } });
  if (p.stories != null) await prisma.ilApartment.updateMany({ where: { projectId, totalFloors: null }, data: { totalFloors: p.stories } });
  if (p.completionDate) {
    await prisma.ilApartment.updateMany({ where: { projectId, OR: [{ completionDate: null }, { completionDate: "" }] }, data: { completionDate: p.completionDate } });
    await prisma.ilHouse.updateMany({ where: { projectId, OR: [{ completionDate: null }, { completionDate: "" }] }, data: { completionDate: p.completionDate } });
  }
  // the project's developers are its units' developers when a unit names none
  if (p.developerId) {
    await prisma.ilApartment.updateMany({ where: { projectId, developerId: null }, data: { developerId: p.developerId, developerIds: p.developerIds } });
    await prisma.ilHouse.updateMany({ where: { projectId, developerId: null }, data: { developerId: p.developerId, developerIds: p.developerIds } });
  }
  if (p.developerIds) {
    await prisma.ilApartment.updateMany({ where: { projectId, developerId: p.developerId, developerIds: null }, data: { developerIds: p.developerIds } });
    await prisma.ilHouse.updateMany({ where: { projectId, developerId: p.developerId, developerIds: null }, data: { developerIds: p.developerIds } });
  }
}
