import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { str } from "@/lib/format";
import { AQ_ROLES } from "@/lib/acquisitions";
import { AqContactForm } from "../contact-form";
import { createAqContact } from "../../actions";

export const metadata = { title: "New contact" };
export const dynamic = "force-dynamic";

/** New contact. From a property's Owners or Operators window it arrives with the role ticked and gets linked to that property on save. */
export default async function NewAqContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const role = str(sp.role);
  const propertyId = str(sp.propertyId) || null;
  const [companies, property] = await Promise.all([prisma.aqCompany.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), propertyId ? prisma.aqProperty.findUnique({ where: { id: propertyId }, select: { address: true } }) : null]);
  return (
    <>
      <PageHeader title={role === "Owner" ? "New owner" : role === "Operator" ? "New operator" : "New contact"} subtitle={property ? `Will be linked to ${property.address}` : undefined} />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="card p-5">
          <AqContactForm c={{ companyId: str(sp.companyId) || null, roles: JSON.stringify((AQ_ROLES as readonly string[]).includes(role) ? [role] : []) }} companies={companies} propertyId={propertyId} action={createAqContact} />
        </div>
      </div>
    </>
  );
}
