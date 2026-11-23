import Link from "next/link";
import { prisma } from "@/lib/db";
import { audienceWhere, outreachAudience, reachBase } from "@/lib/outreach";

/**
 * On the Send outreach and Follow ups pages of a reach out somebody else started (Jonathan, Nov 23, 2026: "when I send I follow up
 * with my own reach outs and when he sends he follows up with his"): says whose it is, that launching is theirs, and links to the
 * same page of your own latest reach out. The launch action refuses it too (reachOutOwnedByOther); this is so nobody is surprised.
 */
export async function OutreachOwnerNote({ outreach, ownerId, meId, details, page }: { outreach: boolean; ownerId: string | null; meId: string | null | undefined; details: string | null; page: "send" | "followup" }) {
  if (!outreach || !ownerId || !meId || ownerId === meId) return null;
  const audience = outreachAudience(details);
  const [owner, mine] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }),
    prisma.deal.findFirst({ where: { ...audienceWhere(audience), ownerId: meId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
  ]);
  const who = owner?.name?.split(" ")[0] ?? "a colleague";
  return (
    <div className="mx-auto mt-3 max-w-[1400px] px-5">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        This is {who}&apos;s reach out, not yours. You can look, but its emails and follow-ups go from {who}&apos;s mailbox, so only {who} can launch them.{" "}
        {mine ? (
          <Link href={`${reachBase(audience)}/reach/${mine.id}/${page}`} className="font-semibold underline">
            Open yours: {mine.name}
          </Link>
        ) : (
          <Link href={reachBase(audience)} className="font-semibold underline">
            Start your own
          </Link>
        )}
      </div>
    </div>
  );
}
