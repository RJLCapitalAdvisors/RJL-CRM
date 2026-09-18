"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AQ_ROLES, AQ_STAGES, digitsOf, ensureLlc, lines, mergeAqRoles, parseJsonList, toJsonList } from "@/lib/acquisitions";
import { forgetAqGeo } from "@/lib/aq-geocode";
import { getAqDealStages, saveAqDealStages } from "@/lib/acquisitions-stages";

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
const date = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null;
};
const sameDay = (a: Date | null, b: Date | null) => Boolean(a && b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10));

/**
 * The property ticket's fields (Jonathan's list, Sep 18, 2026). Call Result is one pick and becomes the stage:
 * Callback needs a target date, which also fills Follow Up Date unless that was typed over; Wrong number drops the
 * picked phone from the property (and from linked contacts, in updateAqProperty); Deal opens the pipeline stage.
 * The list page's stage cell still writes the stages list directly (setAqPropertyStages).
 */
function propertyData(fd: FormData, dealStages: string[]) {
  const picked = s(fd, "callResult");
  const stages = picked && (AQ_STAGES as readonly string[]).includes(picked) ? [picked] : fd.has("callResult") ? [] : parseJsonList(list(fd, "stages", AQ_STAGES));
  const callBack = stages.includes("Callback") ? date(fd, "callBackAt") : null;
  const followUp = date(fd, "followUpAt") ?? callBack;
  const deletePhone = stages.includes("Wrong number") ? s(fd, "deletePhone") : null;
  const drop = (p: string | null) => (p && deletePhone && digitsOf(p) === digitsOf(deletePhone) ? null : p);
  const otherPhones = lines(s(fd, "otherPhones"))
    .filter((p) => !(deletePhone && digitsOf(p) === digitsOf(deletePhone)))
    .join("\n");
  const lastCall = date(fd, "lastCallDate") ?? (picked ? new Date() : null);
  return {
    data: {
      address: s(fd, "address") ?? "Property",
      city: s(fd, "city"),
      state: s(fd, "state")?.toUpperCase().slice(0, 2) ?? null,
      businessName: s(fd, "businessName"),
      assetType: s(fd, "assetType"),
      parcelId: s(fd, "parcelId"),
      ownerEntity: ensureLlc(s(fd, "ownerEntity")),
      ownerName: s(fd, "ownerName"),
      primaryPhone: drop(s(fd, "primaryPhone")),
      secondaryPhone: drop(s(fd, "secondaryPhone")),
      otherPhones: otherPhones || null,
      primaryEmail: s(fd, "primaryEmail")?.toLowerCase() ?? null,
      emails: lines(s(fd, "emails")).map((e) => e.toLowerCase()).join("\n") || null,
      ownerMailingAddress: s(fd, "ownerMailingAddress"),
      acreage: n(fd, "acreage"),
      squareFeet: i(fd, "squareFeet"),
      yearBuilt: i(fd, "yearBuilt"),
      lastSaleDate: date(fd, "lastSaleDate"),
      lastSalePrice: n(fd, "lastSalePrice"),
      lastCallDate: lastCall,
      stages: JSON.stringify(stages),
      callBackAt: callBack,
      followUpAt: followUp,
      // a fresh call-back date reopens the reminder; without the stage the dismissal is moot
      ...(callBack ? { callBackDismissedAt: null } : {}),
      callNotes: s(fd, "callNotes"),
      dealStage: stages.includes("Deal") ? (s(fd, "dealStage") && dealStages.includes(s(fd, "dealStage")!) ? s(fd, "dealStage") : dealStages[0]) : null,
    },
    deletePhone,
  };
}
export async function createAqProperty(fd: FormData) {
  const p = await prisma.aqProperty.create({ data: propertyData(fd, await getAqDealStages()).data });
  touchAll();
  redirect(`/acquisitions/properties/${p.id}`);
}
export async function updateAqProperty(id: string, fd: FormData) {
  const { data, deletePhone } = propertyData(fd, await getAqDealStages());
  const before = await prisma.aqProperty.findUnique({ where: { id }, select: { callBackAt: true } });
  // an unchanged date keeps its dismissal; a new date brings the reminder back
  const sameDate = before?.callBackAt && data.callBackAt && before.callBackAt.getTime() === data.callBackAt.getTime();
  if (sameDate) delete (data as { callBackDismissedAt?: null }).callBackDismissedAt;
  await prisma.aqProperty.update({ where: { id }, data });
  if (deletePhone) {
    const linked = await prisma.aqContact.findMany({ where: { properties: { some: { propertyId: id } }, phone: { not: null } }, select: { id: true, phone: true } });
    for (const c of linked) if (digitsOf(c.phone) === digitsOf(deletePhone)) await prisma.aqContact.update({ where: { id: c.id }, data: { phone: null } });
  }
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}
export async function setAqPropertyStages(id: string, stages: string[], _focus: string | null = null) {
  const clean = (AQ_STAGES as readonly string[]).filter((r) => stages.includes(r));
  const [cur, dealStages] = await Promise.all([prisma.aqProperty.findUnique({ where: { id }, select: { dealStage: true } }), getAqDealStages()]);
  await prisma.aqProperty.update({ where: { id }, data: { stages: JSON.stringify(clean), dealStage: clean.includes("Deal") ? cur?.dealStage ?? dealStages[0] : null } });
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}
export async function setAqDealStage(id: string, stage: string) {
  if (!(await getAqDealStages()).includes(stage)) return;
  const cur = await prisma.aqProperty.findUnique({ where: { id }, select: { stages: true } });
  const stages = parseJsonList(cur?.stages);
  await prisma.aqProperty.update({ where: { id }, data: { dealStage: stage, stages: JSON.stringify(stages.includes("Deal") ? stages : [...stages, "Deal"]) } });
  revalidatePath(`/acquisitions/properties/${id}`);
  touchAll();
}
// ---------- pipeline stages (data: Setting aqDealStages) ----------
type StageResult = { ok: true } | { ok: false; reason: string };
const stagesChanged = () => {
  revalidatePath("/acquisitions/pipeline");
  touchAll();
};
export async function addAqDealStage(name: string): Promise<StageResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "Give the stage a name." };
  const cur = await getAqDealStages();
  if (cur.some((x) => x.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "There is already a stage called " + clean + "." };
  await saveAqDealStages([...cur, clean]);
  stagesChanged();
  return { ok: true };
}
/** Rename a stage; every deal sitting in it moves with the name. */
export async function renameAqDealStage(from: string, to: string): Promise<StageResult> {
  const clean = to.trim();
  if (!clean) return { ok: false, reason: "Give the stage a name." };
  const cur = await getAqDealStages();
  if (!cur.includes(from)) return { ok: false, reason: "That stage is gone; reload the page." };
  if (clean !== from && cur.some((x) => x.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "There is already a stage called " + clean + "." };
  if (clean === from) return { ok: true };
  await saveAqDealStages(cur.map((x) => (x === from ? clean : x)));
  await prisma.aqProperty.updateMany({ where: { dealStage: from }, data: { dealStage: clean } });
  stagesChanged();
  return { ok: true };
}
/** Move a stage one column left (-1) or right (+1). */
export async function moveAqDealStage(name: string, dir: -1 | 1): Promise<StageResult> {
  const cur = await getAqDealStages();
  const i = cur.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cur.length) return { ok: true };
  const next = [...cur];
  [next[i], next[j]] = [next[j], next[i]];
  await saveAqDealStages(next);
  stagesChanged();
  return { ok: true };
}
/** Remove an empty stage. A stage with deals in it stays until they are moved. */
export async function deleteAqDealStage(name: string): Promise<StageResult> {
  const cur = await getAqDealStages();
  if (!cur.includes(name)) return { ok: true };
  if (cur.length === 1) return { ok: false, reason: "The pipeline needs at least one stage." };
  const inIt = await prisma.aqProperty.count({ where: { dealStage: name, stages: { contains: '"Deal"' } } });
  if (inIt) return { ok: false, reason: inIt + (inIt === 1 ? " deal is" : " deals are") + " in " + name + ". Move them first." };
  await saveAqDealStages(cur.filter((x) => x !== name));
  stagesChanged();
  return { ok: true };
}
// ---------- transcripts and the map ----------
/** A call transcript pasted onto the property; the newest shows on top of the Transcript card. */
export async function addAqTranscript(propertyId: string, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await prisma.aqTranscript.create({ data: { propertyId, body } });
  revalidatePath(`/acquisitions/properties/${propertyId}`);
}
export async function deleteAqTranscript(propertyId: string, id: string) {
  await prisma.aqTranscript.deleteMany({ where: { id, propertyId } });
  revalidatePath(`/acquisitions/properties/${propertyId}`);
}
/** Forget the map pin so the next page load looks the address up again. */
export async function recheckAqLocation(id: string) {
  await forgetAqGeo(id);
  revalidatePath(`/acquisitions/properties/${id}`);
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
