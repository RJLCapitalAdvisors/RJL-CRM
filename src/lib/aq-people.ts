import { prisma } from "@/lib/db";
import { digitsOf, lines, mergeAqRoles, parseJsonList, toJsonList } from "@/lib/acquisitions";

/**
 * The owner and the operator typed on a property ticket become records of their own (Jonathan, Sep 22, 2026): the
 * entity is a company, the person is a contact at it, both carry the role (Owner or Operator), both are linked to
 * the property, and the phones and emails flow onto the contact so everything is tracked in one place. The ticket
 * remembers which contact it made (ownerContactId, operatorContactId) so later edits update the same record.
 */
const ci = "insensitive" as const;
const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
};

async function companyFor(name: string | null, role: "Owner" | "Operator"): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const found = await prisma.aqCompany.findFirst({ where: { name: { equals: n, mode: ci } } });
  if (found) {
    const roles = parseJsonList(found.roles);
    if (!roles.includes(role)) await prisma.aqCompany.update({ where: { id: found.id }, data: { roles: toJsonList([...roles, role]) } });
    return found.id;
  }
  return (await prisma.aqCompany.create({ data: { name: n, roles: toJsonList([role]) } })).id;
}

async function personFor(opts: { existingId: string | null; name: string | null; email: string | null; phone: string | null; secondaryPhone: string | null; otherPhones: string | null; emails: string | null; companyId: string | null; role: "Owner" | "Operator" }): Promise<string | null> {
  const name = opts.name?.trim() ?? "";
  const email = opts.email?.trim().toLowerCase() ?? "";
  if (!name && !email) return null;
  const { firstName, lastName } = name ? splitName(name) : { firstName: null, lastName: null };
  const phones = [opts.phone, opts.secondaryPhone, ...lines(opts.otherPhones)].map((x) => x?.trim()).filter((x): x is string => Boolean(x));
  const allEmails = [email, ...lines(opts.emails).map((e) => e.toLowerCase())].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  const company = opts.companyId ? await prisma.aqCompany.findUnique({ where: { id: opts.companyId }, select: { roles: true } }) : null;
  const notes = [phones.length > 1 ? `Other phones: ${phones.slice(1).join(", ")}` : null, allEmails.length > 1 ? `Other emails: ${allEmails.slice(1).join(", ")}` : null].filter(Boolean).join("\n") || null;
  let found = opts.existingId ? await prisma.aqContact.findUnique({ where: { id: opts.existingId } }) : null;
  if (!found && email) found = await prisma.aqContact.findFirst({ where: { email: { equals: email, mode: ci } } });
  if (!found && name) found = await prisma.aqContact.findFirst({ where: { firstName: { equals: firstName ?? "", mode: ci }, lastName: { equals: lastName ?? "", mode: ci }, ...(opts.companyId ? { companyId: opts.companyId } : {}) } });
  const roles = mergeAqRoles(toJsonList([...(found ? parseJsonList(found.roles) : []), opts.role]), company?.roles);
  if (found) {
    // the ticket is the source for what it holds; anything the ticket does not say stays as it was
    await prisma.aqContact.update({
      where: { id: found.id },
      data: {
        firstName: firstName ?? found.firstName,
        lastName: lastName ?? found.lastName,
        email: email || found.email,
        phone: phones[0] ?? found.phone,
        companyId: opts.companyId ?? found.companyId,
        roles,
        notes: notes ? (found.notes && !found.notes.includes(notes) ? `${found.notes}\n${notes}` : found.notes ?? notes) : found.notes,
      },
    });
    return found.id;
  }
  const made = await prisma.aqContact.create({ data: { firstName, lastName, email: email || null, phone: phones[0] ?? null, companyId: opts.companyId, roles, notes } });
  return made.id;
}

/** After a property is saved: the owner and operator records exist, carry the ticket's details, and are linked to the property. */
export async function syncPropertyPeople(propertyId: string): Promise<void> {
  const p = await prisma.aqProperty.findUnique({ where: { id: propertyId } });
  if (!p) return;
  const ownerCompanyId = await companyFor(p.ownerEntity, "Owner");
  const ownerContactId = await personFor({ existingId: p.ownerContactId, name: p.ownerName, email: p.primaryEmail, phone: p.primaryPhone, secondaryPhone: p.secondaryPhone, otherPhones: p.otherPhones, emails: p.emails, companyId: ownerCompanyId, role: "Owner" });
  const operatorCompanyId = await companyFor(p.operatorEntity ?? p.businessName, "Operator");
  const operatorContactId = await personFor({ existingId: p.operatorContactId, name: p.operatorName, email: p.operatorEmail, phone: p.operatorPhone, secondaryPhone: p.operatorSecondaryPhone, otherPhones: p.operatorOtherPhones, emails: p.operatorEmails, companyId: operatorCompanyId, role: "Operator" });
  for (const companyId of [ownerCompanyId, operatorCompanyId]) if (companyId) await prisma.aqPropertyCompany.upsert({ where: { propertyId_companyId: { propertyId, companyId } }, create: { propertyId, companyId }, update: {} });
  for (const contactId of [ownerContactId, operatorContactId]) if (contactId) await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId, contactId } }, create: { propertyId, contactId }, update: {} });
  if (ownerContactId !== p.ownerContactId || operatorContactId !== p.operatorContactId) await prisma.aqProperty.update({ where: { id: propertyId }, data: { ownerContactId, operatorContactId } });
}

/** A phone the ticket dropped as a wrong number leaves the owner and operator contacts too. */
export async function dropPhoneFromPeople(propertyId: string, phone: string) {
  const linked = await prisma.aqContact.findMany({ where: { properties: { some: { propertyId } }, phone: { not: null } }, select: { id: true, phone: true } });
  for (const c of linked) if (digitsOf(c.phone) === digitsOf(phone)) await prisma.aqContact.update({ where: { id: c.id }, data: { phone: null } });
}
