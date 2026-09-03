import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DealForm } from "@/components/deal-form";
import { createDeal } from "../actions";

export default async function NewDealPage() {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New deal" />
      <div className="card mx-8 my-6 max-w-5xl p-6">
        <DealForm deal={null} users={users} action={createDeal} submitLabel="Create deal" />
      </div>
    </>
  );
}
