import { prisma } from "@/lib/db";
import { ilFullName, parseJsonList } from "@/lib/israel";

/** Dropdown choices for a deal: apartments in the list, contacts marked Buyer, contacts marked Sales agent. */
export async function dealOptions() {
  const [apartments, people] = await Promise.all([
    prisma.ilApartment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    prisma.ilContact.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, roles: true, company: { select: { name: true } } } }),
  ]);
  const label = (p: (typeof people)[number]) => `${ilFullName(p)}${p.company ? ` (${p.company.name})` : ""}`;
  return {
    apartments: apartments.map((a) => ({ id: a.id, label: a.city ? `${a.name} · ${a.city}` : a.name })),
    buyers: people.filter((p) => parseJsonList(p.roles).includes("Buyer")).map((p) => ({ id: p.id, label: label(p) })),
    agents: people.filter((p) => parseJsonList(p.roles).includes("Sales agent")).map((p) => ({ id: p.id, label: label(p) })),
  };
}
