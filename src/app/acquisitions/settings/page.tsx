import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { UsersCard } from "@/components/users-card";
import { currentUser } from "@/lib/current-user";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** RJL Acquisitions > Settings: who opens this side. A person is added with their @rjlcapadvisors.com address; Jonathan grants Acquisitions under RJL CA's Users. */
export default async function AqSettingsPage() {
  const [users, me] = await Promise.all([prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }), currentUser()]);
  return (
    <>
      <PageHeader title="Settings" subtitle="Who uses RJL Acquisitions. Their @rjlcapadvisors.com mailbox is read into this side, not into RJL Capital Advisors." />
      <div className="mx-auto max-w-5xl space-y-4 px-8 py-6">
        <UsersCard users={users} workspace="AQ" canEdit={Boolean(me?.canEditCriteria)} meId={me?.id} />
      </div>
    </>
  );
}
