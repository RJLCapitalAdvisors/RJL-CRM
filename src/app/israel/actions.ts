"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IL_DEAL_STAGES } from "@/lib/israel";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const n = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v == null) return null;
  const x = Number(v.replace(/[^0-9.\-]/g, ""));
  return isNaN(x) ? null : x;
};
const i = (fd: FormData, k: string) => {
  const x = n(fd, k);
  return x == null ? null : Math.trunc(x);
};
const list = (fd: FormData, k: string) => JSON.stringify(fd.getAll(k).map(String).filter(Boolean));
const yesNo = (fd: FormData, k: string) => (fd.has(k) ? s(fd, k) === "Yes" : undefined);

function apartmentData(fd: FormData) {
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "Apartment"),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    rooms: n(fd, "rooms"),
    completionDate: s(fd, "completionDate"),
    floor: i(fd, "floor"),
    totalFloors: i(fd, "totalFloors"),
    buildingUnits: i(fd, "buildingUnits"),
    internalSqm: n(fd, "internalSqm"),
    mirpesetSqm: n(fd, "mirpesetSqm"),
    ceilingCm: n(fd, "ceilingCm"),
    machsanSqm: n(fd, "machsanSqm"),
    machsanLocation: s(fd, "machsanLocation"),
    parkingSpots: s(fd, "parkingSpots"),
    direction: list(fd, "direction"),
    mirpesetDirection: list(fd, "mirpesetDirection"),
    mamad: yesNo(fd, "mamad") ?? false,
    priceNis: n(fd, "priceNis"),
    description: s(fd, "description"),
  };
}

export async function createApartment(fd: FormData) {
  const a = await prisma.ilApartment.create({ data: apartmentData(fd) });
  revalidatePath("/israel/apartments");
  redirect(`/israel/apartments/${a.id}`);
}

export async function updateApartment(id: string, fd: FormData) {
  await prisma.ilApartment.update({ where: { id }, data: apartmentData(fd) });
  revalidatePath(`/israel/apartments/${id}`);
  revalidatePath("/israel/apartments");
}

/** The associations in the right column: developer (company), sales agent and seller (contacts). */
export async function linkApartment(id: string, fd: FormData) {
  const data: { developerId?: string | null; agentContactId?: string | null; sellerContactId?: string | null } = {};
  if (fd.has("developerId")) data.developerId = s(fd, "developerId");
  if (fd.has("agentContactId")) data.agentContactId = s(fd, "agentContactId");
  if (fd.has("sellerContactId")) data.sellerContactId = s(fd, "sellerContactId");
  await prisma.ilApartment.update({ where: { id }, data });
  revalidatePath(`/israel/apartments/${id}`);
}

export async function deleteApartment(id: string) {
  await prisma.ilApartment.delete({ where: { id } });
  revalidatePath("/israel/apartments");
  redirect("/israel/apartments");
}

export async function addIlNote(target: { apartmentId?: string; contactId?: string; companyId?: string; dealId?: string }, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await prisma.ilNote.create({ data: { ...target, body } });
  if (target.apartmentId) revalidatePath(`/israel/apartments/${target.apartmentId}`);
  if (target.contactId) revalidatePath(`/israel/contacts/${target.contactId}`);
  if (target.companyId) revalidatePath(`/israel/companies/${target.companyId}`);
  if (target.dealId) revalidatePath(`/israel/deals/${target.dealId}`);
}

function companyData(fd: FormData) {
  return { name: s(fd, "name") ?? "Company", kind: s(fd, "kind"), city: s(fd, "city"), website: s(fd, "website"), phone: s(fd, "phone"), notes: s(fd, "notes") };
}
export async function createIlCompany(fd: FormData) {
  const c = await prisma.ilCompany.create({ data: companyData(fd) });
  revalidatePath("/israel/companies");
  redirect(`/israel/companies/${c.id}`);
}
export async function updateIlCompany(id: string, fd: FormData) {
  await prisma.ilCompany.update({ where: { id }, data: companyData(fd) });
  revalidatePath(`/israel/companies/${id}`);
  revalidatePath("/israel/companies");
}

function contactData(fd: FormData) {
  return {
    firstName: s(fd, "firstName"),
    lastName: s(fd, "lastName"),
    email: s(fd, "email")?.toLowerCase() ?? null,
    phone: s(fd, "phone"),
    companyId: s(fd, "companyId"),
    roles: list(fd, "roles"),
    language: s(fd, "language"),
    budgetMinNis: n(fd, "budgetMinNis"),
    budgetMaxNis: n(fd, "budgetMaxNis"),
    wantsCities: s(fd, "wantsCities"),
    wantsRooms: s(fd, "wantsRooms"),
    notes: s(fd, "notes"),
  };
}
export async function createIlContact(fd: FormData) {
  const c = await prisma.ilContact.create({ data: contactData(fd) });
  revalidatePath("/israel/contacts");
  redirect(`/israel/contacts/${c.id}`);
}
export async function updateIlContact(id: string, fd: FormData) {
  await prisma.ilContact.update({ where: { id }, data: contactData(fd) });
  revalidatePath(`/israel/contacts/${id}`);
  revalidatePath("/israel/contacts");
}

// ---------- deals: the funnel ----------
function dealData(fd: FormData) {
  return {
    name: s(fd, "name") ?? "Deal",
    apartmentId: s(fd, "apartmentId"),
    buyerContactId: s(fd, "buyerContactId"),
    agentContactId: s(fd, "agentContactId"),
    offerNis: n(fd, "offerNis"),
    agreedPriceNis: n(fd, "agreedPriceNis"),
    expectedClose: s(fd, "expectedClose"),
    lostReason: s(fd, "lostReason"),
    description: s(fd, "description"),
  };
}
export async function createIlDeal(fd: FormData) {
  const data = dealData(fd);
  if (!s(fd, "name")) {
    const [apt, buyer] = await Promise.all([data.apartmentId ? prisma.ilApartment.findUnique({ where: { id: data.apartmentId }, select: { name: true } }) : null, data.buyerContactId ? prisma.ilContact.findUnique({ where: { id: data.buyerContactId }, select: { firstName: true, lastName: true } }) : null]);
    data.name = [buyer ? [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") : null, apt?.name].filter(Boolean).join(" · ") || "Deal";
  }
  const d = await prisma.ilDeal.create({ data: { ...data, stage: s(fd, "stage") ?? "Lead" } });
  revalidatePath("/israel/deals");
  redirect(`/israel/deals/${d.id}`);
}
export async function updateIlDeal(id: string, fd: FormData) {
  await prisma.ilDeal.update({ where: { id }, data: dealData(fd) });
  revalidatePath(`/israel/deals/${id}`);
  revalidatePath("/israel/deals");
}
export async function moveIlDeal(id: string, stage: string) {
  if (!(IL_DEAL_STAGES as readonly string[]).includes(stage)) return;
  await prisma.ilDeal.update({ where: { id }, data: { stage, closedAt: stage === "Closed" || stage === "Lost" ? new Date() : null } });
  await prisma.ilNote.create({ data: { dealId: id, body: `Stage: ${stage}` } });
  revalidatePath("/israel/deals");
  revalidatePath(`/israel/deals/${id}`);
}
export async function deleteIlDeal(id: string) {
  await prisma.ilDeal.delete({ where: { id } });
  revalidatePath("/israel/deals");
  redirect("/israel/deals");
}
