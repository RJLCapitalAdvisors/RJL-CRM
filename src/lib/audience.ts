import { prisma } from "@/lib/db";
import { matchDeal, type DealLike, type MatchResult } from "@/lib/matching";
import { parseList } from "@/lib/taxonomy";

export type AudienceRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  roles: string[];
  companyId: string | null;
  companyName: string | null;
  criteriaSource: "contact" | "company" | "none";
  match: MatchResult;
};

/**
 * Build the sendable audience for a deal: contacts with the requested role that have an
 * email, are not unsubscribed, and have not hard-bounced. Each is scored against the deal.
 */
export async function buildAudience(deal: DealLike, role: string | null): Promise<AudienceRow[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      email: { not: null },
      unsubscribed: false,
      bounceReason: null,
      ...(role ? { roles: { contains: `"${role}"` } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      roles: true,
      companyId: true,
      criteria: true,
      company: { select: { name: true, criteria: true } },
    },
  });

  return contacts
    .map((c) => {
      const crit = c.criteria ?? c.company?.criteria ?? null;
      const source: AudienceRow["criteriaSource"] = c.criteria ? "contact" : c.company?.criteria ? "company" : "none";
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email!,
        roles: parseList(c.roles),
        companyId: c.companyId,
        companyName: c.company?.name ?? null,
        criteriaSource: source,
        match: matchDeal(crit, deal),
      };
    })
    .sort((a, b) => b.match.score - a.match.score || (a.companyName ?? "").localeCompare(b.companyName ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? ""));
}
