import { prisma } from "@/lib/db";
import { parseList, toJson } from "@/lib/taxonomy";

/** Personal / free mailbox providers: never treated as a company domain. */
export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "optonline.net", "mail.com", "yandex.com", "gmx.com", "zoho.com",
]);

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = email.trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return null;
  const d = m[1].replace(/^www\./, "");
  return FREE_MAIL.has(d) ? null : d;
}

/** "citivestinc.com" -> "Citivestinc" ; "mousse-partners.com" -> "Mousse Partners" */
export function nameFromDomain(domain: string): string {
  const base = domain.split(".")[0];
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The company a contact with this email belongs to: match on domain, then on website,
 * otherwise create one named after the domain. Returns null for free-mail addresses.
 */
export async function companyForEmail(email: string | null | undefined, nameHint?: string | null) {
  const domain = domainOf(email);
  if (!domain) return null;
  const existing =
    (await prisma.company.findFirst({ where: { domain } })) ??
    (await prisma.company.findFirst({ where: { website: { contains: domain } } }));
  if (existing) {
    if (!existing.domain) await prisma.company.update({ where: { id: existing.id }, data: { domain } });
    return existing;
  }
  const created = await prisma.company.create({ data: { name: nameHint?.trim() || nameFromDomain(domain), domain, website: `https://${domain}` } });
  // Read their website in the background so the record fills itself in (name, description, city, roles…).
  import("@/lib/enrich").then((m) => m.enrichCompany(created.id)).catch(() => {});
  return created;
}

/**
 * Find or create the contact for an email address, attach it to its domain company,
 * and give it the company's roles (plus any extra roles passed in).
 */
export async function contactForEmail(email: string, opts: { name?: string | null; companyNameHint?: string | null; extraRoles?: string[] } = {}) {
  const clean = email.trim().toLowerCase();
  const existing = await prisma.contact.findUnique({ where: { email: clean }, include: { company: true } });
  const company = existing?.company ?? (await companyForEmail(clean, opts.companyNameHint));
  const [firstName, ...rest] = (opts.name ?? "").trim().split(/\s+/).filter(Boolean);
  const inherited = parseList(company?.roles);
  const roles = toJson([...(existing ? parseList(existing.roles) : []), ...inherited, ...(opts.extraRoles ?? [])]);
  if (existing) {
    return prisma.contact.update({
      where: { id: existing.id },
      data: { companyId: existing.companyId ?? company?.id ?? null, roles, firstName: existing.firstName ?? firstName ?? null, lastName: existing.lastName ?? (rest.join(" ") || null) },
      include: { company: true },
    });
  }
  return prisma.contact.create({
    data: { email: clean, firstName: firstName ?? null, lastName: rest.join(" ") || null, companyId: company?.id ?? null, roles, marketingContact: false },
    include: { company: true },
  });
}

/**
 * Backfill: give companies a domain from their contacts' emails, link stray contacts to the
 * company with their domain, and create companies for corporate domains that have none.
 */
export async function backfillDomains(log: (s: string) => void = () => {}) {
  // 1) company.domain from the most common corporate domain among its contacts
  const companies = await prisma.company.findMany({ where: { domain: null }, select: { id: true, website: true, contacts: { select: { email: true } } } });
  let setDomains = 0;
  const taken = new Set((await prisma.company.findMany({ where: { domain: { not: null } }, select: { domain: true } })).map((c) => c.domain!));
  for (const c of companies) {
    const counts = new Map<string, number>();
    for (const k of c.contacts) {
      const d = domainOf(k.email);
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let best: string | null = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!best && c.website) best = domainOf(`x@${c.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`);
    if (best && !taken.has(best)) {
      await prisma.company.update({ where: { id: c.id }, data: { domain: best } });
      taken.add(best);
      setDomains++;
    }
  }
  log(`domains set on ${setDomains} companies`);

  // 2) contacts without a company: link by domain or create a company for the domain
  const stray = await prisma.contact.findMany({ where: { companyId: null, email: { not: null } }, select: { id: true, email: true, roles: true } });
  const byDomain = new Map<string, string>((await prisma.company.findMany({ where: { domain: { not: null } }, select: { id: true, domain: true } })).map((c) => [c.domain!, c.id]));
  let linked = 0;
  let created = 0;
  for (const k of stray) {
    const d = domainOf(k.email);
    if (!d) continue;
    let companyId = byDomain.get(d);
    if (!companyId) {
      const co = await prisma.company.create({ data: { name: nameFromDomain(d), domain: d, website: `https://${d}` } });
      companyId = co.id;
      byDomain.set(d, co.id);
      created++;
    }
    const co = await prisma.company.findUnique({ where: { id: companyId }, select: { roles: true } });
    await prisma.contact.update({ where: { id: k.id }, data: { companyId, roles: toJson([...parseList(k.roles), ...parseList(co?.roles)]) } });
    linked++;
  }
  log(`linked ${linked} stray contacts; created ${created} companies from email domains`);
  return { setDomains, linked, created };
}
