import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { UsersCard } from "@/components/users-card";
import { currentUser } from "@/lib/current-user";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** RJL Israel > Settings: the people who open RJL Israel, invitations, and what each person can open. */
export default async function IlSettingsPage() {
  const [users, me] = await Promise.all([prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }), currentUser()]);
  return (
    <>
      <PageHeader title="Settings" subtitle="Who uses this side. Add a person by their @rjlisrael.com or @liviemisrael.com email and the invite goes out with the sign-in link." />
      <div className="mx-auto max-w-5xl space-y-4 px-8 py-6">
        <UsersCard users={users} workspace="IL" canEdit={Boolean(me?.canEditCriteria)} />
      </div>
    </>
  );
}
