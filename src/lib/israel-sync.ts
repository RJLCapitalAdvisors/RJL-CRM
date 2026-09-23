import { prisma } from "@/lib/db";

/**
 * What the project knows about its building fills the apartments and houses filed under it (Jonathan, Sep 17): total
 * units and total stories on every apartment, delivery on apartments and houses. Only blanks are filled; a unit's own
 * value, typed or extracted, stays. Called after a project is saved by hand and after the intake touches one (Sep 23,
 * 2026: the Mophet website gave 176 units and 7 floors; the 19 unit tickets under it take them).
 */
export async function syncProjectToUnits(projectId: string) {
  const p = await prisma.ilProject.findUnique({ where: { id: projectId }, select: { totalUnits: true, stories: true, completionDate: true, developerId: true, developerIds: true } });
  if (!p) return;
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
