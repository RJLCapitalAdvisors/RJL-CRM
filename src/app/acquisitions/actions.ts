"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AQ_DEAL_STAGES, AQ_ROLES, AQ_STAGES, mergeAqRoles, parseJsonList, toJsonList } from "@/lib/acquisitions";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const n = (fd: FormData, k: string) => {
  const v = s(fd, k)?.replace(/[$,\s]/g, "");
  if (!v) return null;
  const x = Number(v);
  return isNaN(x) ? null : x;
};
const i = (fd: FormData, k: string) => {
  const x = n(fd, k);
  return x == null ? null : Math.trunc(x);
};
const list = (fd: FormData, k: string, allowed: readonly string[]) => toJsonList(fd.getAll(k).map(String).filter((x) => allowed.includes(x)));
const touchAll = () => {
  for (const p of ["/acquisitions", "/acquisitions/contacts", "/acquisitions/companies", "/acquisitions/properties", "/acquisitions/pipeline"]) revalidatePath(p);
};

// ---------- companies ----------
function companyData(fd: FormData) {
  const website = s(fd, "website");
  return {
    name: s(fd, "name") ?? "Company",
    roles: list(fd, "roles", AQ_ROLES),
    city: s(fd, "city"),
    state: s(fd, "state")?.toUpperCase().slice(0, 2) ?? null,
    website,
    domain: s(fd, "domain") ?? (website ? website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null),
    phone: s(fd, "phone"),
    notes: s(fd, "notes"),
  };
}
/** A company's roles flow to every contact at the company (an Operator's people are Operators); a contact's own roles stay. */
async function flowRolesToContacts(companyId: string, roles: string[]) {
  const people = await prisma.aqContact.findMany({ where: { companyId }, select: { id: true, roles: true } });
  for (const c of people) await prisma.aqContact.update({ where: { id: c.id }, data: { roles: mergeAqRoles(c.roles, JSON.stringify(roles)) } });
}
export async function createAqCompany(fd: FormData) {
  const c = await prisma.aqCompany.create({ data: companyData(fd) });
  touchAll();
  redirect(`/acquisitions/companies/${c.id}`);
}
export async function updateAqCompany(id: string, fd: FormData) {
  const data = companyData(fd);
  await prisma.aqCompany.update({ where: { id }, data });
  await flowRolesToContacts(id, parseJsonList(data.roles));
  revalidatePath(`/acquisitions/companies/${id}`);
  touchAll();
}
export async function setAqCompanyRoles(id: string, roles: string[], _focus: string | null = null) {
  const clean = (AQ_ROLES as readonly string[]).filter((r) => roles.includes(r));
  await prisma.aqCompany.update({ where: { id }, data: { roles: JSON.stringify(clean) } });
  await flowRolesToContacts(id, clean);
  revalidatePath(`/acquisitions/companies/${id}`);
  touchAll();
}
export async function deleteAqCompany(id: string) {
  await prisma.aqCompany.delete({ where: { id } });
  touchAll();
  redirect("/acquisitions/companies");
}

// ---------- contacts ----------
function contactData(fd: FormData) {
  return {
    firstName: s(fd, "firstName"),
    lastName: s(fd, "lastName"),
    email: s(fd, "email")?.toLowerCase() ?? null,
    phone: s(fd, "phone"),
    companyId: s(fd, "companyId"),
    roles: list(fd, "roles", AQ_ROLES),
    notes: s(fd, "notes"),
  };
}
export async function createAqContact(fd: FormData) {
  const data = contactData(fd);
  const co = data.companyId ? await prisma.aqCompany.findUnique({ where: { id: data.companyId }, select: { roles: true } }) : null;
  const c = await prisma.aqContact.create({ data: { ...data, roles: mergeAqRoles(data.roles, co?.roles) } });
  touchAll();
  redirect(`/acquisitions/contacts/${c.id}`);
}
export async function updateAqContact(id: string, fd: FormData) {
  const data = contactData(fd);
  const co = data.companyId ? await prisma.aqCompany.findUnique({ where: { id: data.companyId }, select: { roles: true } }) : null;
  await prisma.aqContact.update({ where: { id }, data: { ...data, roles: mergeAqRoles(data.roles, co?.roles) } });
  revalidatePath(`/acquisitions/contacts/${id}`);
  touchAll();
}
export async function setAqContactRoles(id: string, roles: string[], _focus: string | null = null) {
  const clean = (AQ_ROLES as readonly string[]).filter((r) => roles.includes(r));
  await prisma.aqContact.update({ where: { id }, data: { roles: JSON.stringify(clean) } });
  revalidatePath(`/acquisitions/contacts/${id}`);
  touchAll();
}
export async function deleteAqContact(id: string) {
  await prisma.aqContact.delete({ where: { id } });
  touchAll();
  redirect("/acquisitions/contacts");
}

// ---------- properties ----------
function propertyData(fd: FormData) {
  const stages = parseJsonList(list(fd, "stages", AQ_STAGES));
  const callBackRaw = s(fd, "callBackAt");
  const callBack = stages.includes("Call me back") && callBackRaw ? new Date(`${callBackRaw}T12:00:00`) : null;
  return {
    address: s(fd, "address") ?? "Property",
    neighborhood: s(fd, "neighborhood"),
    city: s(fd, "city"),
    state: s(fd, "state")?.toUpperCase().slice(0, 2) ?? null,
    stages: JSON.stringify(stages),
    callBackAt: callBack,
    // a fresh call-back date reopens the reminder; without the stage the dismissal is moot
    ...(callBack ? { callBackDismissedAt: null } : {}),
    dealStage: stages.includes("Deal") ? (s(fd, "dealStage") && (AQ_DEAL_STAGES as readonly string[]).includes(s(fd, "dealStage")!) ? s(fd, "dealStage") : AQ_DEAL_STAGES[0]) : null,
    askingPrice: n(fd, "askingPrice"),
    units: i(fd, "units"),
    squareFeet: i(fd, "squareFeet"),
    assetType: s(fd, "assetType"),
    notes: s(fd, "notes"),
  };
}
export async function createAqProperty(fd: FormData) {
  const p = await prisma.aqProperty.create({ data: propertyData(fd) });
  touchAll();
  redirect(`/acquisitions/properties/${p.id}`);
}
export async function updateAqProperty(id: string, fd: FormData) {
  const data = propertyData(fd);
  const before = await prisma.aqProperty.findUnique({ where: { id }, select: { callBackAt: true } });
  // an unchanged date keeps its dismissal; a new date brings the reminder back
  const sameDate = before?.callBackAt && data.callBackAt && before.callBackAt.getTime() === data.callBackAt.getTime();
  if (sameDate) delete (data as { callBackDismissedAt?: null }).callBackDismissedAt;
  await prisma.aqProperty.update({ where: { id }, data });
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}
export async function setAqPropertyStages(id: string, stages: string[], _focus: string | null = null) {
  const clean = (AQ_STAGES as readonly string[]).filter((r) => stages.includes(r));
  const cur = await prisma.aqProperty.findUnique({ where: { id }, select: { dealStage: true } });
  await prisma.aqProperty.update({ where: { id }, data: { stages: JSON.stringify(clean), dealStage: clean.includes("Deal") ? cur?.dealStage ?? AQ_DEAL_STAGES[0] : null } });
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}
export async function setAqDealStage(id: string, stage: string) {
  if (!(AQ_DEAL_STAGES as readonly string[]).includes(stage)) return;
  const cur = await prisma.aqProperty.findUnique({ where: { id }, select: { stages: true } });
  const stages = parseJsonList(cur?.stages);
  await prisma.aqProperty.update({ where: { id }, data: { dealStage: stage, stages: JSON.stringify(stages.includes("Deal") ? stages : [...stages, "Deal"]) } });
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}
export async function dismissCallBack(id: string) {
  await prisma.aqProperty.update({ where: { id }, data: { callBackDismissedAt: new Date() } });
  touchAll();
}
export async function deleteAqProperty(id: string) {
  await prisma.aqProperty.delete({ where: { id } });
  touchAll();
  redirect("/acquisitions/properties");
}
/** The right column of a property: link or unlink a company or a contact. */
export async function linkAqProperty(id: string, fd: FormData) {
  const companyId = s(fd, "companyId"), contactId = s(fd, "contactId"), unlinkCompany = s(fd, "unlinkCompanyId"), unlinkContact = s(fd, "unlinkContactId");
  if (companyId) await prisma.aqPropertyCompany.upsert({ where: { propertyId_companyId: { propertyId: id, companyId } }, create: { propertyId: id, companyId }, update: {} });
  if (contactId) await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId: id, contactId } }, create: { propertyId: id, contactId }, update: {} });
  if (unlinkCompany) await prisma.aqPropertyCompany.deleteMany({ where: { propertyId: id, companyId: unlinkCompany } });
  if (unlinkContact) await prisma.aqPropertyContact.deleteMany({ where: { propertyId: id, contactId: unlinkContact } });
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}

// ---------- notes ----------
export async function addAqNote(target: { contactId?: string; companyId?: string; propertyId?: string }, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await prisma.aqNote.create({ data: { body, contactId: target.contactId, companyId: target.companyId, propertyId: target.propertyId } });
  if (target.contactId) revalidatePath(`/acquisitions/contacts/${target.contactId}`);
  if (target.companyId) revalidatePath(`/acquisitions/companies/${target.companyId}`);
  if (target.propertyId) revalidatePath(`/acquisitions/properties/${target.propertyId}`);
}
