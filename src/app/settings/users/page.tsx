import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { UsersCard } from "@/components/users-card";
import { currentUser } from "@/lib/current-user";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

/** Settings > Users: who opens RJL Capital Advisors, invitations, and what each person can open. */
export default async function UsersPage() {
  const [users, me] = await Promise.all([prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }), currentUser()]);
  return (
    <>
      <PageHeader title="Users" subtitle="Who opens RJL Capital Advisors. Add a person by email and the invite goes out with the sign-in link." />
      <div className="mx-auto max-w-5xl space-y-4 px-8 py-6">
        <UsersCard users={users} workspace="CA" canEdit={Boolean(me?.canEditCriteria)} />
      </div>
    </>
  );
}
