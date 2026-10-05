"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { digitsOf, lines, normalizePhone } from "@/lib/acquisitions";

type R = { ok: true; redirect?: string } | { ok: false; reason: string };
const touch = () => {
  for (const p of ["/acquisitions", "/acquisitions/contacts", "/acquisitions/properties", "/acquisitions/properties/map", "/acquisitions/pipeline", "/acquisitions/deals", "/acquisitions/junk/phones", "/acquisitions/junk/properties"]) revalidatePath(p);
  revalidatePath("/acquisitions/pipeline", "layout");
};

/**
 * Junk (Shawn, Sep 23, 2026; its own sidebar section since Oct 5, 2026): a property goes whole to Junk > Junk
 * Properties with everything on its card, hidden from the Properties list, the map, the pipeline and the dashboard,
 * restorable. Removed Reason, Removed Date and Source File are kept on the record.
 */
export async function junkAqProperty(id: string, reason: string | null, source: string | null = null): Promise<R> {
  const me = await currentUser();
  const p = await prisma.aqProperty.findUnique({ where: { id }, select: { id: true, junkedAt: true } });
  if (!p) return { ok: false, reason: "That property is gone." };
  if (p.junkedAt) return { ok: true, redirect: "/acquisitions/junk/properties" };
  await prisma.aqProperty.update({ where: { id }, data: { junkedAt: new Date(), junkedBy: me?.name ?? null, junkReason: reason?.trim() || null, ...(source ? { junkSource: source } : {}) } });
  touch();
  revalidatePath(`/acquisitions/properties/${id}`);
  return { ok: true, redirect: "/acquisitions/properties" };
}
/** Restore: back on the live Properties list; the reason, date and source file are cleared. */
export async function restoreAqProperty(id: string) {
  await prisma.aqProperty.update({ where: { id }, data: { junkedAt: null, junkedBy: null, junkReason: null, junkSource: null } });
  touch();
  revalidatePath(`/acquisitions/properties/${id}`);
}
/** Gone for good: the card, its notes, transcripts and links. Only from the Junk Properties page, after the junk step. */
export async function destroyAqProperty(id: string) {
  const p = await prisma.aqProperty.findUnique({ where: { id }, select: { junkedAt: true } });
  if (!p?.junkedAt) return;
  await prisma.aqProperty.delete({ where: { id } });
  touch();
}

const PHONE_FIELDS = new Set(["phone", "secondaryPhone", "otherPhones", "storePhone", "directoryOperatorPhone"]);

/** Every junked number as digit strings, for the filters that keep them off contacts. */
export async function junkPhoneDigits(): Promise<Set<string>> {
  const rows = await prisma.aqJunkPhone.findMany({ select: { digits: true } });
  return new Set(rows.map((r) => r.digits));
}

/**
 * Record a number as junk (from a right-click, the Junk Phone Numbers page or an import) and take it off every contact
 * that carries it. The row keeps the contact, the property and the file it came from, so Restore can put it back.
 */
export async function addJunkPhone(raw: string, opts: { contactId?: string | null; contactName?: string | null; propertyId?: string | null; field?: string | null; reason?: string | null; sourceFile?: string | null; by?: string | null } = {}) {
  const digits = digitsOf(raw);
  if (digits.length < 6) return null;
  // the contact it came off, when the caller did not say: the first carrier
  let contactId = opts.contactId ?? null, contactName = opts.contactName ?? null, field = opts.field ?? null, propertyId = opts.propertyId ?? null;
  const carriers = await prisma.aqContact.findMany({
    where: { OR: [{ phone: { contains: digits.slice(-7) } }, { secondaryPhone: { contains: digits.slice(-7) } }, { otherPhones: { contains: digits.slice(-7) } }, { storePhone: { contains: digits.slice(-7) } }, { directoryOperatorPhone: { contains: digits.slice(-7) } }] },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, secondaryPhone: true, otherPhones: true, storePhone: true, directoryOperatorPhone: true, properties: { select: { propertyId: true }, take: 1 } },
  });
  for (const c of carriers) {
    const data: Record<string, string | null> = {};
    let from: string | null = null;
    for (const f of ["phone", "secondaryPhone", "storePhone", "directoryOperatorPhone"] as const) {
      if (c[f] && digitsOf(c[f]) === digits) {
        data[f] = null;
        from = from ?? f;
      }
    }
    if (c.otherPhones) {
      const kept = lines(c.otherPhones).filter((l) => digitsOf(l) !== digits);
      if (kept.length !== lines(c.otherPhones).length) {
        data.otherPhones = kept.join("\n") || null;
        from = from ?? "otherPhones";
      }
    }
    if (Object.keys(data).length) await prisma.aqContact.update({ where: { id: c.id }, data });
    if (!contactId && from) {
      contactId = c.id;
      contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
      field = field && field !== "import" && field !== "by hand" ? field : from;
      propertyId = propertyId ?? c.properties[0]?.propertyId ?? null;
    }
  }
  if (contactId && !propertyId) propertyId = (await prisma.aqPropertyContact.findFirst({ where: { contactId }, select: { propertyId: true } }))?.propertyId ?? null;
  return prisma.aqJunkPhone.upsert({
    where: { digits },
    update: { reason: opts.reason ?? undefined, contactId: contactId ?? undefined, contactName: contactName ?? undefined, field: field ?? undefined, propertyId: propertyId ?? undefined, sourceFile: opts.sourceFile ?? undefined },
    create: { digits, raw: raw.trim(), contactId, contactName, field, propertyId, reason: opts.reason ?? null, sourceFile: opts.sourceFile ?? null, createdBy: opts.by ?? null },
  });
}

/** Right-click on a number: off this contact (and any other carrying it) and into the junk list. */
export async function junkAqPhone(contactId: string, field: string, phone: string, reason: string | null, propertyId: string | null = null): Promise<R> {
  if (!PHONE_FIELDS.has(field) && field !== "any") return { ok: false, reason: "That is not a phone field." };
  const digits = digitsOf(phone);
  if (digits.length < 6) return { ok: false, reason: "That does not look like a phone number." };
  const me = await currentUser();
  const c = await prisma.aqContact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, email: true } });
  await addJunkPhone(phone, { contactId, contactName: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email : null, propertyId, field, reason: reason?.trim() || null, by: me?.name ?? null });
  touch();
  revalidatePath(`/acquisitions/contacts/${contactId}`);
  return { ok: true };
}
/** Off the junk list; the number is not put back on anyone, it may be typed again. */
export async function forgetJunkPhone(id: string) {
  await prisma.aqJunkPhone.delete({ where: { id } }).catch(() => null);
  revalidatePath("/acquisitions/junk/phones");
}
/** Restore (Oct 5, 2026): the number goes back on the contact it came off, in the field it was in (or Other Phones when that field is taken), and leaves the junk list. */
export async function restoreJunkPhone(id: string): Promise<R> {
  const row = await prisma.aqJunkPhone.findUnique({ where: { id } });
  if (!row) return { ok: false, reason: "That number is gone from the list." };
  if (row.contactId) {
    const c = await prisma.aqContact.findUnique({ where: { id: row.contactId }, select: { phone: true, secondaryPhone: true, otherPhones: true, storePhone: true, directoryOperatorPhone: true } });
    if (c) {
      const has = [c.phone, c.secondaryPhone, c.storePhone, c.directoryOperatorPhone, ...lines(c.otherPhones)].some((x) => x && normalizePhone(x) === normalizePhone(row.raw));
      if (!has) {
        const single = ["phone", "secondaryPhone", "storePhone", "directoryOperatorPhone"] as const;
        const f = single.find((x) => x === row.field) ?? null;
        const data = f && !c[f] ? { [f]: row.raw } : !f && !c.phone ? { phone: row.raw } : { otherPhones: [...lines(c.otherPhones), row.raw].join("\n") };
        await prisma.aqContact.update({ where: { id: row.contactId }, data });
      }
      revalidatePath(`/acquisitions/contacts/${row.contactId}`);
    }
  }
  await prisma.aqJunkPhone.delete({ where: { id } });
  touch();
  return { ok: true };
}

/** Typed on the Junk Phone Numbers page: junk the number and count the contacts it came off. */
export async function junkAqPhoneByHand(phone: string, reason: string | null): Promise<{ ok: true; removedFrom: number } | { ok: false; reason: string }> {
  const digits = digitsOf(phone);
  if (digits.length < 6) return { ok: false, reason: "That does not look like a phone number." };
  const me = await currentUser();
  const before = await prisma.aqContact.count({ where: { OR: [{ phone: { contains: digits.slice(-7) } }, { secondaryPhone: { contains: digits.slice(-7) } }, { otherPhones: { contains: digits.slice(-7) } }, { storePhone: { contains: digits.slice(-7) } }, { directoryOperatorPhone: { contains: digits.slice(-7) } }] } });
  await addJunkPhone(phone, { field: "by hand", reason: reason?.trim() || null, by: me?.name ?? null });
  touch();
  return { ok: true, removedFrom: before };
}
