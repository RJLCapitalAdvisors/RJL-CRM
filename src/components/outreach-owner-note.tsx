import { prisma } from "@/lib/db";

/**
 * On the Send outreach and Follow ups pages of a reach out somebody else started (Jonathan, Nov 23, 2026: "when I send I follow up
 * with my own reach outs and when he sends he follows up with his"): says whose it is, and that launching is theirs. The launch
 * action refuses it too (reachOutOwnedByOther); this is so nobody is surprised.
 */
export async function OutreachOwnerNote({ outreach, ownerId, meId }: { outreach: boolean; ownerId: string | null; meId: string | null | undefined }) {
  if (!outreach || !ownerId || !meId || ownerId === meId) return null;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
  const who = owner?.name?.split(" ")[0] ?? "a colleague";
  return (
    <div className="mx-auto mt-3 max-w-[1400px] px-5">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        This is {who}&apos;s reach out. You can look, but its emails and follow-ups go from {who}&apos;s mailbox, so only {who} can launch them. Who was reached out to is shared, so Sponsor search and Investor search still show these firms as reached.
      </div>
    </div>
  );
}
