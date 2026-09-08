import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { createContact } from "../actions";
import { str } from "@/lib/format";

export const metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const companyId = str(sp.companyId);
  const [users, company] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    companyId ? prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, city: true, state: true } }) : null,
  ]);
  const seed = company
    ? {
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        title: null,
        roles: "[]",
        accredited: null,
        streetAddress: null,
        notes: null,
        ownerId: null,
        marketingContact: true,
        unsubscribed: false,
        company,
      }
    : null;
  return (
    <>
      <PageHeader title="New contact" />
      <div className="card mx-8 my-6 max-w-3xl p-6">
        <ContactForm contact={seed} users={users} action={createContact} submitLabel="Create contact" />
      </div>
    </>
  );
}
