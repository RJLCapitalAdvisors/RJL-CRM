"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IL_COMPANY_ROLES, IL_DEAL_STAGES, IL_ROLES, mergeIlRoles } from "@/lib/israel";

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
    projectId: s(fd, "projectId"),
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
    sellerType: s(fd, "sellerType"),
    renovationYear: s(fd, "sellerType")?.startsWith("Second hand") ? i(fd, "renovationYear") : null,
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

// ---------- houses ----------
function houseData(fd: FormData) {
  const floors = i(fd, "floors");
  // one ceiling height per floor, in the order the form shows them; extra entries from a lowered floor count are dropped
  const ceilings = fd.getAll("ceilingCm").map((v) => {
    const x = Number(String(v).replace(/[^0-9.]/g, ""));
    return String(v).trim() && !isNaN(x) ? x : "";
  });
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "House"),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    rooms: n(fd, "rooms"),
    floors,
    ceilingCms: JSON.stringify(floors ? ceilings.slice(0, Math.max(0, floors)) : ceilings),
    completionDate: s(fd, "completionDate"),
    internalSqm: n(fd, "internalSqm"),
    mirpesetSqm: n(fd, "mirpesetSqm"),
    migrashSqm: n(fd, "migrashSqm"),
    parkingSpots: s(fd, "parkingSpots"),
    sellerType: s(fd, "sellerType"),
    renovationYear: s(fd, "sellerType")?.startsWith("Second hand") ? i(fd, "renovationYear") : null,
    mamad: yesNo(fd, "mamad") ?? false,
    priceNis: n(fd, "priceNis"),
    description: s(fd, "description"),
  };
}
export async function createHouse(fd: FormData) {
  const h = await prisma.ilHouse.create({ data: houseData(fd) });
  revalidatePath("/israel/houses");
  redirect(`/israel/houses/${h.id}`);
}
export async function updateHouse(id: string, fd: FormData) {
  await prisma.ilHouse.update({ where: { id }, data: houseData(fd) });
  revalidatePath(`/israel/houses/${id}`);
  revalidatePath("/israel/houses");
}
export async function linkHouse(id: string, fd: FormData) {
  const data: { developerId?: string | null; agentContactId?: string | null; sellerContactId?: string | null } = {};
  if (fd.has("developerId")) data.developerId = s(fd, "developerId");
  if (fd.has("agentContactId")) data.agentContactId = s(fd, "agentContactId");
  if (fd.has("sellerContactId")) data.sellerContactId = s(fd, "sellerContactId");
  await prisma.ilHouse.update({ where: { id }, data });
  revalidatePath(`/israel/houses/${id}`);
}
export async function deleteHouse(id: string) {
  await prisma.ilHouse.delete({ where: { id } });
  revalidatePath("/israel/houses");
  redirect("/israel/houses");
}

export async function deleteApartment(id: string) {
  await prisma.ilApartment.delete({ where: { id } });
  revalidatePath("/israel/apartments");
  redirect("/israel/apartments");
}

export async function addIlNote(target: { apartmentId?: string; houseId?: string; contactId?: string; companyId?: string; dealId?: string; projectId?: string }, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await prisma.ilNote.create({ data: { ...target, body } });
  if (target.apartmentId) revalidatePath(`/israel/apartments/${target.apartmentId}`);
  if (target.houseId) revalidatePath(`/israel/houses/${target.houseId}`);
  if (target.contactId) revalidatePath(`/israel/contacts/${target.contactId}`);
  if (target.companyId) revalidatePath(`/israel/companies/${target.companyId}`);
  if (target.dealId) revalidatePath(`/israel/deals/${target.dealId}`);
  if (target.projectId) revalidatePath(`/israel/projects/${target.projectId}`);
}

function companyData(fd: FormData) {
  return { name: s(fd, "name") ?? "Company", roles: list(fd, "roles"), city: s(fd, "city"), website: s(fd, "website"), phone: s(fd, "phone"), notes: s(fd, "notes") };
}
/** A company's roles flow to every contact at it (added, never removed from the person). */
async function flowRolesToContacts(companyId: string, roles: string[]) {
  const people = await prisma.ilContact.findMany({ where: { companyId }, select: { id: true, roles: true } });
  for (const c of people) {
    const merged = mergeIlRoles(c.roles, roles);
    if (merged !== c.roles) await prisma.ilContact.update({ where: { id: c.id }, data: { roles: merged } });
  }
}
export async function createIlCompany(fd: FormData) {
  const c = await prisma.ilCompany.create({ data: companyData(fd) });
  revalidatePath("/israel/companies");
  redirect(`/israel/companies/${c.id}`);
}
/** Roles ticked on a list row or the company header; saved once when the list closes. */
export async function setIlCompanyRoles(id: string, roles: string[]) {
  const clean = (IL_COMPANY_ROLES as readonly string[]).filter((r) => roles.includes(r));
  await prisma.ilCompany.update({ where: { id }, data: { roles: JSON.stringify(clean) } });
  await flowRolesToContacts(id, clean);
  revalidatePath(`/israel/companies/${id}`);
  revalidatePath("/israel/companies");
  revalidatePath("/israel/contacts");
}
export async function setIlContactRoles(id: string, roles: string[]) {
  const clean = (IL_ROLES as readonly string[]).filter((r) => roles.includes(r));
  await prisma.ilContact.update({ where: { id }, data: { roles: JSON.stringify(clean) } });
  revalidatePath(`/israel/contacts/${id}`);
  revalidatePath("/israel/contacts");
}

export async function updateIlCompany(id: string, fd: FormData) {
  const data = companyData(fd);
  await prisma.ilCompany.update({ where: { id }, data });
  await flowRolesToContacts(id, JSON.parse(data.roles) as string[]);
  revalidatePath(`/israel/companies/${id}`);
  revalidatePath("/israel/companies");
  revalidatePath("/israel/contacts");
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
  const data = contactData(fd);
  // a person at a company carries the company's roles
  const co = data.companyId ? await prisma.ilCompany.findUnique({ where: { id: data.companyId }, select: { roles: true } }) : null;
  const c = await prisma.ilContact.create({ data: { ...data, roles: mergeIlRoles(data.roles, co?.roles) } });
  revalidatePath("/israel/contacts");
  redirect(`/israel/contacts/${c.id}`);
}
export async function updateIlContact(id: string, fd: FormData) {
  const data = contactData(fd);
  const co = data.companyId ? await prisma.ilCompany.findUnique({ where: { id: data.companyId }, select: { roles: true } }) : null;
  await prisma.ilContact.update({ where: { id }, data: { ...data, roles: mergeIlRoles(data.roles, co?.roles) } });
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

// ---------- projects: whole buildings, the apartments hang off them ----------
function projectData(fd: FormData) {
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "Project"),
    developerId: s(fd, "developerId"),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    totalUnits: i(fd, "totalUnits"),
    parkingSpaces: i(fd, "parkingSpaces"),
    stories: i(fd, "stories"),
    completionDate: s(fd, "completionDate"),
    description: s(fd, "description"),
  };
}
export async function createIlProject(fd: FormData) {
  const p = await prisma.ilProject.create({ data: projectData(fd) });
  revalidatePath("/israel/projects");
  redirect(`/israel/projects/${p.id}`);
}
export async function updateIlProject(id: string, fd: FormData) {
  await prisma.ilProject.update({ where: { id }, data: projectData(fd) });
  revalidatePath(`/israel/projects/${id}`);
  revalidatePath("/israel/projects");
}
export async function deleteIlProject(id: string) {
  await prisma.ilProject.delete({ where: { id } });
  revalidatePath("/israel/projects");
  redirect("/israel/projects");
}

/** Approve a ticket that came in by email: it leaves Deals to be approved and joins the Apartments list. Only when the data is complete. */
export async function approveApartment(id: string) {
  const { apartmentMissing } = await import("@/lib/israel");
  const a = await prisma.ilApartment.findUnique({ where: { id } });
  if (!a) return;
  const missing = apartmentMissing(a as unknown as Record<string, unknown>);
  if (missing.length) return;
  await prisma.ilApartment.update({ where: { id }, data: { pendingApproval: false } });
  await prisma.ilNote.create({ data: { apartmentId: id, body: "Approved: data complete, added to Apartments." } });
  revalidatePath("/israel");
  revalidatePath("/israel/apartments");
  revalidatePath(`/israel/apartments/${id}`);
}
