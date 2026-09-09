/** Dummy RJL Israel data to start working with: a few developers and agencies, their people, four apartments. Safe to rerun. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function company(name: string, kind: string, city: string, phone: string, website?: string) {
  const found = await prisma.ilCompany.findFirst({ where: { name } });
  return found ?? prisma.ilCompany.create({ data: { name, kind, city, phone, website } });
}
async function contact(firstName: string, lastName: string, roles: string[], extra: { email?: string; phone?: string; companyId?: string; language?: string; budgetMinNis?: number; budgetMaxNis?: number; wantsCities?: string; wantsRooms?: string }) {
  const found = await prisma.ilContact.findFirst({ where: { firstName, lastName } });
  return found ?? prisma.ilContact.create({ data: { firstName, lastName, roles: JSON.stringify(roles), ...extra } });
}

async function main() {
  const harel = await company("Harel Development Ltd.", "Developer", "Jerusalem", "+972 2 622 4400", "https://example.com/harel");
  const benDavid = await company("Ben David Properties", "Developer", "Ra'anana", "+972 9 771 2200");
  const tzur = await company("Tzur Nadlan Agency", "Agency", "Tel Aviv", "+972 3 566 1800");
  const neve = await company("Neve Realty", "Agency", "Jerusalem", "+972 2 563 9090");

  const yael = await contact("Yael", "Tzur", ["Sales agent"], { email: "yael@example.com", phone: "+972 52 300 1122", companyId: tzur.id, language: "Hebrew" });
  const dani = await contact("Dani", "Mizrahi", ["Sales agent"], { email: "dani@example.com", phone: "+972 54 800 4433", companyId: neve.id, language: "English" });
  const noa = await contact("Noa", "Harel", ["Sales agent"], { email: "noa@example.com", phone: "+972 50 611 7788", companyId: harel.id, language: "Hebrew" });
  const eli = await contact("Eli", "Rosen", ["Seller"], { email: "eli.rosen@example.com", phone: "+972 52 990 1010", language: "English" });
  await contact("Sarah", "Goldberg", ["Buyer"], { email: "sarah.g@example.com", phone: "+1 516 555 0142", language: "English", budgetMinNis: 4_000_000, budgetMaxNis: 6_500_000, wantsCities: "Jerusalem, Ra'anana", wantsRooms: "4 to 5" });

  const apartments = [
    { name: "Rehavia Gardens, Apt 12", street: "Ramban 12", city: "Jerusalem", neighborhood: "Rehavia", rooms: 4, completionDate: "06/2027", floor: 3, totalFloors: 6, buildingUnits: 24, internalSqm: 108, mirpesetSqm: 14, ceilingCm: 290, machsanSqm: 6, machsanLocation: "In basement", parkingSpots: "2 side by side", direction: '["South","West"]', mirpesetDirection: '["South"]', mamad: true, priceNis: 5_900_000, developerId: harel.id, agentContactId: noa.id, description: "New build on a quiet street two blocks from Gan Sacher. Delivery with Tofes 4 expected mid 2027." },
    { name: "Arlozorov 45, Apt 8", street: "Arlozorov 45", city: "Tel Aviv", neighborhood: "Old North", rooms: 3, completionDate: "2016", floor: 5, totalFloors: 9, buildingUnits: 36, internalSqm: 82, mirpesetSqm: 10, ceilingCm: 270, machsanSqm: null, machsanLocation: null, parkingSpots: "1", direction: '["North","East"]', mirpesetDirection: '["East"]', mamad: true, priceNis: 4_650_000, agentContactId: yael.id, sellerContactId: eli.id, description: "Resale in a 2016 building, elevator, one covered parking spot." },
    { name: "Ahuza Heights, Penthouse", street: "Ahuza 210", city: "Ra'anana", neighborhood: null, rooms: 5, completionDate: "12/2026", floor: 8, totalFloors: 8, buildingUnits: 32, internalSqm: 145, mirpesetSqm: 60, ceilingCm: 300, machsanSqm: 8, machsanLocation: "Attached to apartment", parkingSpots: "2 - back to back", direction: '["North","South","West"]', mirpesetDirection: '["West"]', mamad: true, priceNis: 8_900_000, developerId: benDavid.id, description: "Top floor penthouse with a wraparound mirpeset. Under construction, delivery end of 2026." },
    { name: "Katamon Garden Apartment", street: "Rachel Imenu 30", city: "Jerusalem", neighborhood: "Katamon", rooms: 4, completionDate: "1985", floor: 0, totalFloors: 4, buildingUnits: 8, internalSqm: 96, mirpesetSqm: null, ceilingCm: 265, machsanSqm: 4, machsanLocation: "In basement", parkingSpots: "None", direction: '["South"]', mirpesetDirection: "[]", mamad: false, priceNis: 4_200_000, agentContactId: dani.id, description: "Ground floor with a 40 m² private garden. Renovated kitchen and bathrooms in 2021." },
  ];
  for (const a of apartments) {
    const found = await prisma.ilApartment.findFirst({ where: { name: a.name } });
    if (found) await prisma.ilApartment.update({ where: { id: found.id }, data: a });
    else await prisma.ilApartment.create({ data: a });
  }
  const sarah = await prisma.ilContact.findFirst({ where: { firstName: "Sarah", lastName: "Goldberg" } });
  const rehavia = await prisma.ilApartment.findFirst({ where: { name: "Rehavia Gardens, Apt 12" } });
  const arlozorov = await prisma.ilApartment.findFirst({ where: { name: "Arlozorov 45, Apt 8" } });
  const deals = [
    { name: "Sarah Goldberg · Rehavia Gardens, Apt 12", stage: "Viewing Scheduled", apartmentId: rehavia?.id, buyerContactId: sarah?.id, agentContactId: noa.id, expectedClose: "Q1 2027", description: "Viewing set for next week. Sarah wants a south-facing mirpeset and two parking spots." },
    { name: "Sarah Goldberg · Arlozorov 45, Apt 8", stage: "Lead", apartmentId: arlozorov?.id, buyerContactId: sarah?.id, agentContactId: yael.id, description: "Sent as a second option in Tel Aviv." },
  ];
  for (const d of deals) {
    const found = await prisma.ilDeal.findFirst({ where: { name: d.name } });
    if (!found) await prisma.ilDeal.create({ data: d });
  }
  console.log("seeded", { deals: await prisma.ilDeal.count(), companies: await prisma.ilCompany.count(), contacts: await prisma.ilContact.count(), apartments: await prisma.ilApartment.count() });
}

main().finally(() => prisma.$disconnect());
