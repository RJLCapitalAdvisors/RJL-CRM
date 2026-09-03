import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "@/components/company-form";
import { createCompany } from "../actions";

export default async function NewCompanyPage() {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New company" />
      <div className="card mx-8 my-6 max-w-4xl p-6">
        <CompanyForm company={null} users={users} action={createCompany} submitLabel="Create company" />
      </div>
    </>
  );
}
