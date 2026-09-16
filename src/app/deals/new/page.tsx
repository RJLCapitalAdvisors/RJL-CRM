import { prisma } from "@/lib/db";
import { CA_TEAM } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { DealForm } from "@/components/deal-form";
import { createDeal } from "../actions";

export const metadata = { title: "New deal" };

export default async function NewDealPage() {
  const users = await prisma.user.findMany({ where: { active: true, ...CA_TEAM }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New deal" />
      <div className="card mx-8 my-6 max-w-5xl p-6">
        <DealForm deal={null} users={users} action={createDeal} submitLabel="Create deal" />
      </div>
    </>
  );
}
