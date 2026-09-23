"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { digitsOf, lines } from "@/lib/acquisitions";

type R = { ok: true; redirect?: string } | { ok: false; reason: string };
const touch = () => {
  for (const p of ["/acquisitions", "/acquisitions/contacts", "/acquisitions/properties", "/acquisitions/properties/map", "/acquisitions/pipeline", "/acquisitions/settings/junk-phones", "/acquisitions/settings/junk-properties"]) revalidatePath(p);
  revalidatePath("/acquisitions/pipeline", "layout");
};

/** Junk (Shawn, Sep 23, 2026): a property goes whole to Settings > Junk Properties, hidden everywhere else, restorable. */
export async function junkAqProperty(id: string, reason: string | null): Promise<R> {
  const me = await currentUser();
  const p = await prisma.aqProperty.findUnique({ where: { id }, select: { id: true, junkedAt: true } });
  if (!p) return { ok: false, reason: "That property is gone." };
  if (p.junkedAt) return { ok: true, redirect: "/acquisitions/settings/junk-properties" };
  await prisma.aqProperty.update({ where: { id }, data: { junkedAt: new Date(), junkedBy: me?.name ?? null, junkReason: reason?.trim() || null } });
  touch();
  revalidatePath(`/acquisitions/properties/${id}`);
  return { ok: true, redirect: "/acquisitions/properties" };
}
export async function restoreAqProperty(id: string) {
  await prisma.aqProperty.update({ where: { id }, data: { junkedAt: null, junkedBy: null, junkReason: null } });
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

/** Record a number as junk (from a right-click or an import) and take it off every contact that carries it. */
export async function addJunkPhone(raw: string, opts: { contactId?: string | null; contactName?: string | null; field?: string | null; reason?: string | null; by?: string | null } = {}) {
  const digits = digitsOf(raw);
  if (digits.length < 6) return null;
  const row = await prisma.aqJunkPhone.upsert({
    where: { digits },
    update: { reason: opts.reason ?? undefined, contactId: opts.contactId ?? undefined, contactName: opts.contactName ?? undefined, field: opts.field ?? undefined },
    create: { digits, raw: raw.trim(), contactId: opts.contactId ?? null, contactName: opts.contactName ?? null, field: opts.field ?? null, reason: opts.reason ?? null, createdBy: opts.by ?? null },
  });
  // off every contact: the single fields blank when they match, the bulleted lists lose that line only
  const carriers = await prisma.aqContact.findMany({
    where: { OR: [{ phone: { contains: digits.slice(-7) } }, { secondaryPhone: { contains: digits.slice(-7) } }, { otherPhones: { contains: digits.slice(-7) } }, { storePhone: { contains: digits.slice(-7) } }, { directoryOperatorPhone: { contains: digits.slice(-7) } }] },
    select: { id: true, phone: true, secondaryPhone: true, otherPhones: true, storePhone: true, directoryOperatorPhone: true },
  });
  for (const c of carriers) {
    const data: Record<string, string | null> = {};
    for (const f of ["phone", "secondaryPhone", "storePhone", "directoryOperatorPhone"] as const) if (c[f] && digitsOf(c[f]) === digits) data[f] = null;
    if (c.otherPhones) {
      const kept = lines(c.otherPhones).filter((l) => digitsOf(l) !== digits);
      if (kept.length !== lines(c.otherPhones).length) data.otherPhones = kept.join("\n") || null;
    }
    if (Object.keys(data).length) await prisma.aqContact.update({ where: { id: c.id }, data });
  }
  return row;
}

/** Right-click on a number: off this contact (and any other carrying it) and into the junk list. */
export async function junkAqPhone(contactId: string, field: string, phone: string, reason: string | null): Promise<R> {
  if (!PHONE_FIELDS.has(field) && field !== "any") return { ok: false, reason: "That is not a phone field." };
  const digits = digitsOf(phone);
  if (digits.length < 6) return { ok: false, reason: "That does not look like a phone number." };
  const me = await currentUser();
  const c = await prisma.aqContact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, email: true } });
  await addJunkPhone(phone, { contactId, contactName: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email : null, field, reason: reason?.trim() || null, by: me?.name ?? null });
  touch();
  revalidatePath(`/acquisitions/contacts/${contactId}`);
  return { ok: true };
}
/** Off the junk list; the number is not put back on anyone, it may be typed again. */
export async function forgetJunkPhone(id: string) {
  await prisma.aqJunkPhone.delete({ where: { id } }).catch(() => null);
  revalidatePath("/acquisitions/settings/junk-phones");
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
