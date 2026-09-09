import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { createApartment } from "../../actions";
import { ApartmentForm } from "../apartment-form";

export const metadata = { title: "New apartment" };
export const dynamic = "force-dynamic";

export default async function NewApartmentPage() {
  const [developers, people] = await Promise.all([prisma.ilCompany.findMany({ where: { kind: "Developer" }, orderBy: { name: "asc" }, select: { id: true, name: true } }), prisma.ilContact.findMany({ orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, roles: true } })]);
  const named = people.map((p) => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "(no name)", roles: p.roles }));
  return (
    <>
      <PageHeader compact title="New apartment" subtitle="Enter what you know; everything can be edited on the ticket later." />
      <div className="mx-auto max-w-3xl px-6 py-5">
        <div className="card p-5">
          <ApartmentForm developers={developers} agents={named.filter((p) => p.roles.includes("Agent"))} sellers={named.filter((p) => p.roles.includes("Seller"))} action={createApartment} submitLabel="Create apartment" />
        </div>
      </div>
    </>
  );
}
