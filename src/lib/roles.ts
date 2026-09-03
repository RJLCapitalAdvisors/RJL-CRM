import { prisma } from "@/lib/db";
import { parseList, toJson } from "@/lib/taxonomy";

/**
 * Company roles flow down to the company's contacts, because email blasts go to
 * contacts and are segmented by Sponsor vs Investor.
 *
 * Rule: contact.roles = (contact.roles − roles the company just dropped) ∪ company roles.
 * Contact-only extras (e.g. a contact who is also a Broker) are preserved.
 */
export async function syncContactRolesForCompany(companyId: string, oldCompanyRoles: string[], newCompanyRoles: string[]) {
  const removed = oldCompanyRoles.filter((r) => !newCompanyRoles.includes(r));
  const contacts = await prisma.contact.findMany({ where: { companyId }, select: { id: true, roles: true } });
  let changed = 0;
  for (const c of contacts) {
    const current = parseList(c.roles);
    const next = Array.from(new Set([...current.filter((r) => !removed.includes(r)), ...newCompanyRoles]));
    const nextJson = toJson(next);
    if (nextJson !== toJson(current)) {
      await prisma.contact.update({ where: { id: c.id }, data: { roles: nextJson } });
      changed++;
    }
  }
  return changed;
}

/** Roles a contact should carry given its own roles plus its company's roles. */
export async function inheritRoles(contactRoles: string[], companyId: string | null) {
  if (!companyId) return contactRoles;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { roles: true } });
  return Array.from(new Set([...contactRoles, ...parseList(company?.roles)]));
}

/** One-time / re-runnable backfill: every contact inherits its company's roles. */
export async function backfillContactRoles(log: (s: string) => void = () => {}) {
  const companies = await prisma.company.findMany({ where: { NOT: { roles: "[]" } }, select: { id: true, roles: true } });
  let changed = 0;
  let i = 0;
  for (const co of companies) {
    changed += await syncContactRolesForCompany(co.id, [], parseList(co.roles));
    if (++i % 500 === 0) log(`  roles synced for ${i} companies`);
  }
  return changed;
}
