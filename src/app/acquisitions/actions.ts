"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AQ_ASSET_TYPES, AQ_ROLES, AQ_STAGES, digitsOf, ensureLlc, lines, mergeAqRoles, parseJsonList, toJsonList } from "@/lib/acquisitions";
import { US_STATES } from "@/lib/taxonomy";
import { forgetAqGeo } from "@/lib/aq-geocode";
import { dropPhoneFromPeople, syncPropertyPeople } from "@/lib/aq-people";
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
      operatorEntity: s(fd, "operatorEntity"),
      operatorName: s(fd, "operatorName"),
      operatorPhone: drop(s(fd, "operatorPhone")),
      operatorSecondaryPhone: drop(s(fd, "operatorSecondaryPhone")),
      operatorOtherPhones: lines(s(fd, "operatorOtherPhones")).filter((p) => !(deletePhone && digitsOf(p) === digitsOf(deletePhone))).join("\n") || null,
      operatorEmail: s(fd, "operatorEmail")?.toLowerCase() ?? null,
      operatorEmails: lines(s(fd, "operatorEmails")).map((e) => e.toLowerCase()).join("\n") || null,
      operatorMailingAddress: s(fd, "operatorMailingAddress"),
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
      dealStage: stages.includes("Deal") ? (s(fd, "dealStage") && dealStages.includes(s(fd, "dealStage")!) ? s(fd, "dealStage") : dealStages[0]) : null,
    },
    deletePhone,
  };
}
export async function createAqProperty(fd: FormData) {
  const p = await prisma.aqProperty.create({ data: propertyData(fd, await getAqDealStages()).data });
  await syncPropertyPeople(p.id).catch(() => null);
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
  if (deletePhone) await dropPhoneFromPeople(id, deletePhone);
  await syncPropertyPeople(id).catch(() => null);
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
// ---------- the list pages' grid (one cell at a time) ----------
type CellResult = { ok: true; row?: Record<string, unknown> } | { ok: false; reason: string };
const PROPERTY_CELLS: Record<string, "text" | "llc" | "state" | "assetType" | "lines" | "number" | "int" | "date" | "callResult" | "dealStage" | "email"> = {
  address: "text", city: "text", state: "state", businessName: "text", assetType: "assetType", parcelId: "text", ownerEntity: "llc", ownerName: "text",
  primaryPhone: "text", secondaryPhone: "text", otherPhones: "lines", primaryEmail: "email", emails: "lines", ownerMailingAddress: "text",
  operatorEntity: "text", operatorName: "text", operatorPhone: "text", operatorSecondaryPhone: "text", operatorOtherPhones: "lines", operatorEmail: "email", operatorEmails: "lines", operatorMailingAddress: "text",
  acreage: "number", squareFeet: "int", yearBuilt: "int", lastSaleDate: "date", lastSalePrice: "number", lastCallDate: "date",
  callResult: "callResult", callBackAt: "date", followUpAt: "date", dealStage: "dealStage", neighborhood: "text", askingPrice: "number", units: "int", notes: "text",
};
const COMPANY_CELLS: Record<string, "text" | "state" | "roles" | "name"> = { name: "name", website: "text", phone: "text", city: "text", state: "state", notes: "text", roles: "roles" };
const CONTACT_CELLS: Record<string, "text" | "email" | "roles" | "companyId"> = { firstName: "text", lastName: "text", email: "email", phone: "text", notes: "text", roles: "roles", companyId: "companyId" };
const numOf = (v: string | null) => {
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const dayOf = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00`) : null);
const tokensOf = (v: string | null, allowed: readonly string[]) => {
  try {
    const arr = JSON.parse(v ?? "[]") as unknown;
    return Array.isArray(arr) ? arr.map(String).filter((x) => allowed.includes(x)) : [];
  } catch {
    return [];
  }
};

/**
 * One cell from the Excel-like list pages (Properties, Companies, Contacts): the field is checked against the list
 * of what the grid may edit, the value is read the way the ticket reads it (LLC appended to the owner, two-letter
 * state, one-per-line lists, dates at noon), and the side effects the ticket has still happen (Callback fills the
 * follow-up date, a company's roles flow to its people, a contact's roles pick up its company's).
 */
export async function updateAqCell(kind: "property" | "company" | "contact", id: string, key: string, value: string | null): Promise<CellResult> {
  try {
    const text = value?.trim() ? value.trim() : null;
    if (kind === "property") {
      const t = PROPERTY_CELLS[key];
      if (!t) return { ok: false, reason: `${key} cannot be edited here.` };
      if (t === "callResult") {
        const stage = text && (AQ_STAGES as readonly string[]).includes(text) ? [text] : [];
        await setAqPropertyStages(id, stage);
        const p = await prisma.aqProperty.findUnique({ where: { id }, select: { dealStage: true, stages: true } });
        return { ok: true, row: { callResult: parseJsonList(p?.stages)[0] ?? null, dealStage: p?.dealStage ?? null } };
      }
      if (t === "dealStage") {
        if (!text) return { ok: false, reason: "Pick a stage, or clear the Call result instead." };
        await setAqDealStage(id, text);
        return { ok: true, row: { callResult: "Deal", dealStage: text } };
      }
      const data: Record<string, unknown> = {};
      if (t === "text") data[key] = key === "address" ? text ?? "Property" : text;
      else if (t === "email") data[key] = text?.toLowerCase() ?? null;
      else if (t === "llc") data[key] = ensureLlc(text);
      else if (t === "state") {
        const st = text?.toUpperCase().slice(0, 2) ?? null;
        if (st && !US_STATES[st]) return { ok: false, reason: `${text} is not a state code.` };
        data[key] = st;
      } else if (t === "assetType") {
        if (text && !(AQ_ASSET_TYPES as readonly string[]).includes(text)) return { ok: false, reason: `Asset type must be one of ${AQ_ASSET_TYPES.join(", ")}.` };
        data[key] = text;
      } else if (t === "lines") data[key] = lines(text).join("\n") || null;
      else if (t === "number") data[key] = numOf(text);
      else if (t === "int") {
        const n = numOf(text);
        data[key] = n == null ? null : Math.round(n);
      } else if (t === "date") {
        const d = dayOf(text);
        if (text && !d) return { ok: false, reason: "Use a date." };
        data[key] = d;
        if (key === "callBackAt" && d) {
          const cur = await prisma.aqProperty.findUnique({ where: { id }, select: { followUpAt: true, callBackAt: true } });
          data.callBackDismissedAt = null;
          if (!cur?.followUpAt || (cur.callBackAt && cur.followUpAt.getTime() === cur.callBackAt.getTime())) data.followUpAt = d;
        }
      }
      await prisma.aqProperty.update({ where: { id }, data });
      if (/^(owner|operator|primary|secondary|other|emails|businessName)/.test(key)) await syncPropertyPeople(id).catch(() => null);
      revalidatePath(`/acquisitions/properties/${id}`);
      touchAll();
      const row: Record<string, unknown> = { [key]: data[key] instanceof Date ? (data[key] as Date).toISOString() : data[key] };
      if (data.followUpAt instanceof Date) row.followUpAt = data.followUpAt.toISOString();
      return { ok: true, row };
    }
    if (kind === "company") {
      const t = COMPANY_CELLS[key];
      if (!t) return { ok: false, reason: `${key} cannot be edited here.` };
      if (t === "roles") {
        await setAqCompanyRoles(id, tokensOf(value, AQ_ROLES));
        return { ok: true };
      }
      if (t === "name" && !text) return { ok: false, reason: "A company needs a name." };
      const st = t === "state" ? text?.toUpperCase().slice(0, 2) ?? null : undefined;
      if (st && !US_STATES[st]) return { ok: false, reason: `${text} is not a state code.` };
      const data: Record<string, unknown> = { [key]: t === "state" ? st : text };
      if (key === "website") data.domain = text ? text.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() || null : null;
      await prisma.aqCompany.update({ where: { id }, data });
      revalidatePath(`/acquisitions/companies/${id}`);
      touchAll();
      return { ok: true, row: { [key]: data[key] } };
    }
    const t = CONTACT_CELLS[key];
    if (!t) return { ok: false, reason: `${key} cannot be edited here.` };
    if (t === "roles") {
      await setAqContactRoles(id, tokensOf(value, AQ_ROLES));
      return { ok: true };
    }
    if (t === "companyId") {
      const co = text ? await prisma.aqCompany.findUnique({ where: { id: text }, select: { id: true, roles: true } }) : null;
      if (text && !co) return { ok: false, reason: "That company is gone; reload the page." };
      const cur = await prisma.aqContact.findUnique({ where: { id }, select: { roles: true } });
      await prisma.aqContact.update({ where: { id }, data: { companyId: co?.id ?? null, roles: mergeAqRoles(cur?.roles, co?.roles) } });
      revalidatePath(`/acquisitions/contacts/${id}`);
      touchAll();
      const roles = parseJsonList(mergeAqRoles(cur?.roles, co?.roles));
      return { ok: true, row: { companyId: co?.id ?? null, roles } };
    }
    await prisma.aqContact.update({ where: { id }, data: { [key]: t === "email" ? text?.toLowerCase() ?? null : text } });
    revalidatePath(`/acquisitions/contacts/${id}`);
    touchAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

// ---------- transcripts and the map ----------
/** A call transcript pasted onto the property; the newest shows on top of the Transcript card. */
export async function deleteAqNote(propertyId: string, id: string) {
  await prisma.aqNote.deleteMany({ where: { id, propertyId } });
  revalidatePath(`/acquisitions/properties/${propertyId}`);
  touchAll();
}
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
