import { prisma } from "@/lib/db";
import { CA_TEAM } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "@/components/company-form";
import { createCompany } from "../actions";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  const users = await prisma.user.findMany({ where: { active: true, ...CA_TEAM }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New company" />
      <div className="card mx-8 my-6 max-w-4xl p-6">
        <CompanyForm company={null} users={users} action={createCompany} submitLabel="Create company" />
      </div>
    </>
  );
}
