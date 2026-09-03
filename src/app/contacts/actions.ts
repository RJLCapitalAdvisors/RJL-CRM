"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/taxonomy";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function contactData(fd: FormData) {
  const acc = s(fd, "accredited");
  return {
    firstName: s(fd, "firstName"),
    lastName: s(fd, "lastName"),
    email: s(fd, "email")?.toLowerCase() ?? null,
    phone: s(fd, "phone"),
    title: s(fd, "title"),
    roles: toJson(fd.getAll("roles").map(String)),
    accredited: acc == null ? null : acc === "yes",
    streetAddress: s(fd, "streetAddress"),
    notes: s(fd, "notes"),
    companyId: s(fd, "companyId"),
    ownerId: s(fd, "ownerId"),
    marketingContact: fd.get("marketingContact") === "on",
    unsubscribed: fd.get("unsubscribed") === "on",
  };
}

export async function createContact(fd: FormData) {
  const c = await prisma.contact.create({ data: contactData(fd) });
  revalidatePath("/contacts");
  redirect(`/contacts/${c.id}`);
}

export async function updateContact(id: string, fd: FormData) {
  await prisma.contact.update({ where: { id }, data: contactData(fd) });
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

export async function addContactNote(id: string, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  const contact = await prisma.contact.findUnique({ where: { id }, select: { companyId: true } });
  await prisma.activity.create({ data: { type: "NOTE", body, contactId: id, companyId: contact?.companyId ?? null } });
  await prisma.contact.update({ where: { id }, data: { lastActivityAt: new Date() } });
  revalidatePath(`/contacts/${id}`);
}

export async function searchCompanies(q: string) {
  if (!q.trim()) return [];
  return prisma.company.findMany({ where: { name: { contains: q.trim() } }, select: { id: true, name: true, city: true, state: true }, take: 10, orderBy: { name: "asc" } });
}
