"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AQ_ASSET_TYPES, AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, digitsOf, ensureLlc, lines, mergeAqRoles, parseJsonList, toJsonList, AQ_PIPELINES, type AqPipeline } from "@/lib/acquisitions";
import { US_STATES } from "@/lib/taxonomy";
import { forgetAqGeo } from "@/lib/aq-geocode";
import { junkPhoneDigits } from "./junk-actions";
import { getAqDealStages, getAqStages, saveAqStages } from "@/lib/acquisitions-stages";

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

/** Junk numbers (Settings > Junk Phone Numbers) are never written onto a contact: single fields blank, bulleted lists lose the line (Shawn, Sep 23, 2026). */
async function scrubJunkPhones<T extends Record<string, unknown>>(data: T): Promise<T> {
  const junk = await junkPhoneDigits();
  if (!junk.size) return data;
  const out: Record<string, unknown> = { ...data };
  for (const f of ["phone", "secondaryPhone", "storePhone", "directoryOperatorPhone"]) if (typeof out[f] === "string" && junk.has(digitsOf(out[f] as string))) out[f] = null;
  if (typeof out.otherPhones === "string") out.otherPhones = lines(out.otherPhones as string).filter((l) => !junk.has(digitsOf(l))).join("\n") || null;
  return out as T;
}
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
const dateOf = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null;
};
/**
 * The contact card's fields (Sep 22, 2026): who they are and how to reach them, the operator details, and the call.
 * Callback needs a target date, which also fills Follow Up Date unless that was typed over; Wrong number drops the
 * picked phone from every phone field on the card.
 */
function contactData(fd: FormData) {
  const callResult = s(fd, "callResult");
  const result = callResult && (AQ_STAGES as readonly string[]).includes(callResult) ? callResult : null;
  const callBack = result === "Callback" ? dateOf(fd, "callBackAt") : null;
  const followUp = dateOf(fd, "followUpAt") ?? callBack;
  const deletePhone = result === "Wrong number" ? s(fd, "deletePhone") : null;
  const drop = (p: string | null) => (p && deletePhone && digitsOf(p) === digitsOf(deletePhone) ? null : p);
  const total = s(fd, "operatorTotalLocations");
  const roles = parseJsonList(list(fd, "roles", AQ_ROLES));
  return {
    firstName: s(fd, "firstName"),
    lastName: s(fd, "lastName"),
    email: s(fd, "email")?.toLowerCase() ?? null,
    emails: lines(s(fd, "emails")).map((e) => e.toLowerCase()).join("\n") || null,
    phone: drop(s(fd, "phone")),
    secondaryPhone: drop(s(fd, "secondaryPhone")),
    otherPhones: lines(s(fd, "otherPhones")).filter((p) => !(deletePhone && digitsOf(p) === digitsOf(deletePhone))).join("\n") || null,
    mailingAddress: s(fd, "mailingAddress"),
    companyId: s(fd, "companyId"),
    roles: list(fd, "roles", AQ_ROLES),
    notes: s(fd, "notes"),
    operatorBrandName: s(fd, "operatorBrandName"),
    website: s(fd, "website"),
    operatorEntityName: s(fd, "operatorEntityName"),
    directoryOperatorName: s(fd, "directoryOperatorName"),
    storePhone: drop(s(fd, "storePhone")),
    directoryOperatorPhone: drop(s(fd, "directoryOperatorPhone")),
    operatorTotalLocations: total && Number.isFinite(Number(total)) ? Math.round(Number(total)) : null,
    operatorPipelineStatus: (AQ_OPERATOR_STATUSES as readonly string[]).includes(s(fd, "operatorPipelineStatus") ?? "") ? s(fd, "operatorPipelineStatus") : null,
    ...(fd.has("buyerStage") || !roles.includes("Buyer") ? { buyerStage: roles.includes("Buyer") ? s(fd, "buyerStage") : null } : {}),
    ...(fd.has("operatorStage") || !roles.includes("Operator") ? { operatorStage: roles.includes("Operator") ? s(fd, "operatorStage") : null } : {}),
    lastCallDate: dateOf(fd, "lastCallDate") ?? (result ? new Date() : null),
    callResult: result,
    callBackAt: callBack,
    followUpAt: followUp,
    ...(callBack ? { callBackDismissedAt: null } : {}),
  };
}
export async function createAqContact(fd: FormData) {
  const data = await scrubJunkPhones(contactData(fd));
  const co = data.companyId ? await prisma.aqCompany.findUnique({ where: { id: data.companyId }, select: { roles: true } }) : null;
  const c = await prisma.aqContact.create({ data: { ...data, roles: mergeAqRoles(data.roles, co?.roles) } });
  // from a property's Owners or Operators window: linked to that property straight away
  const propertyId = s(fd, "propertyId");
  if (propertyId) await prisma.aqPropertyContact.create({ data: { propertyId, contactId: c.id } }).catch(() => null);
  touchAll();
  redirect(propertyId ? `/acquisitions/properties/${propertyId}` : `/acquisitions/contacts/${c.id}`);
}
export async function updateAqContact(id: string, fd: FormData) {
  const data = await scrubJunkPhones(contactData(fd));
  const co = data.companyId ? await prisma.aqCompany.findUnique({ where: { id: data.companyId }, select: { roles: true } }) : null;
  const before = await prisma.aqContact.findUnique({ where: { id }, select: { callBackAt: true } });
  // an unchanged callback date keeps its dismissal; a new date brings the reminder back
  if (before?.callBackAt && data.callBackAt && before.callBackAt.getTime() === data.callBackAt.getTime()) delete (data as { callBackDismissedAt?: null }).callBackDismissedAt;
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

/** The property ticket's fields (Sep 22, 2026): the property, the physical facts and last sale, and whether it is in the Deal Pipeline. People and calls live on the contact cards. */
function propertyData(fd: FormData, dealStages: string[]) {
  const deal = fd.get("deal") === "1" || fd.get("deal") === "on";
  return {
    address: s(fd, "address") ?? "Property",
    city: s(fd, "city"),
    state: s(fd, "state")?.toUpperCase().slice(0, 2) ?? null,
    county: s(fd, "county")?.replace(/\s+county$/i, "") ?? null,
    businessName: s(fd, "businessName"),
    assetType: s(fd, "assetType"),
    parcelId: s(fd, "parcelId"),
    acreage: n(fd, "acreage"),
    squareFeet: i(fd, "squareFeet"),
    yearBuilt: i(fd, "yearBuilt"),
    lastSaleDate: date(fd, "lastSaleDate"),
    lastSalePrice: n(fd, "lastSalePrice"),
    stages: JSON.stringify(deal ? ["Deal"] : []),
    dealStage: deal ? (s(fd, "dealStage") && dealStages.includes(s(fd, "dealStage")!) ? s(fd, "dealStage") : dealStages[0]) : null,
  };
}
export async function createAqProperty(fd: FormData) {
  const p = await prisma.aqProperty.create({ data: propertyData(fd, await getAqDealStages()) });
  touchAll();
  redirect(`/acquisitions/properties/${p.id}`);
}
export async function updateAqProperty(id: string, fd: FormData) {
  await prisma.aqProperty.update({ where: { id }, data: propertyData(fd, await getAqDealStages()) });
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
/** A buyer or operator moves to another column of its pipeline; the role goes on if it was missing (Sep 23, 2026). */
export async function setAqContactStage(pipeline: "buyers" | "operators", id: string, stage: string) {
  if (!(await getAqStages(pipeline)).includes(stage)) return;
  const def = AQ_PIPELINES[pipeline];
  const cur = await prisma.aqContact.findUnique({ where: { id }, select: { roles: true } });
  const roles = parseJsonList(cur?.roles);
  await prisma.aqContact.update({ where: { id }, data: { [def.field]: stage, roles: JSON.stringify(def.role && !roles.includes(def.role) ? [...roles, def.role] : roles) } });
  revalidatePath(`/acquisitions/contacts/${id}`);
  touchAll();
}
// ---------- pipeline stages (data: Setting aqBuyerStages, aqOperatorStages, aqDealStages) ----------
type StageResult = { ok: true } | { ok: false; reason: string };
const stagesChanged = () => {
  revalidatePath("/acquisitions/pipeline", "layout");
  touchAll();
};
/** How many things sit in a stage: deals are properties carrying Deal, buyers and operators are contacts with the role. */
async function inStage(pipeline: AqPipeline, name: string) {
  if (pipeline === "deals") return prisma.aqProperty.count({ where: { dealStage: name, stages: { contains: '"Deal"' }, junkedAt: null } });
  const def = AQ_PIPELINES[pipeline];
  return prisma.aqContact.count({ where: { [def.field]: name, roles: { contains: `"${def.role}"` } } });
}
export async function addAqStage(pipeline: AqPipeline, name: string): Promise<StageResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "Give the stage a name." };
  const cur = await getAqStages(pipeline);
  if (cur.some((x) => x.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "There is already a stage called " + clean + "." };
  await saveAqStages(pipeline, [...cur, clean]);
  stagesChanged();
  return { ok: true };
}
/** Rename a stage; everything sitting in it moves with the name. */
export async function renameAqStage(pipeline: AqPipeline, from: string, to: string): Promise<StageResult> {
  const clean = to.trim();
  if (!clean) return { ok: false, reason: "Give the stage a name." };
  const cur = await getAqStages(pipeline);
  if (!cur.includes(from)) return { ok: false, reason: "That stage is gone; reload the page." };
  if (clean !== from && cur.some((x) => x.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "There is already a stage called " + clean + "." };
  if (clean === from) return { ok: true };
  await saveAqStages(pipeline, cur.map((x) => (x === from ? clean : x)));
  if (pipeline === "deals") await prisma.aqProperty.updateMany({ where: { dealStage: from }, data: { dealStage: clean } });
  else await prisma.aqContact.updateMany({ where: { [AQ_PIPELINES[pipeline].field]: from }, data: { [AQ_PIPELINES[pipeline].field]: clean } });
  stagesChanged();
  return { ok: true };
}
/** Move a stage one column left (-1) or right (+1). */
export async function moveAqStage(pipeline: AqPipeline, name: string, dir: -1 | 1): Promise<StageResult> {
  const cur = await getAqStages(pipeline);
  const i = cur.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cur.length) return { ok: true };
  const next = [...cur];
  [next[i], next[j]] = [next[j], next[i]];
  await saveAqStages(pipeline, next);
  stagesChanged();
  return { ok: true };
}
/** Remove an empty stage. A stage with cards in it stays until they are moved. */
export async function deleteAqStage(pipeline: AqPipeline, name: string): Promise<StageResult> {
  const cur = await getAqStages(pipeline);
  if (!cur.includes(name)) return { ok: true };
  if (cur.length === 1) return { ok: false, reason: "The pipeline needs at least one stage." };
  const n = await inStage(pipeline, name);
  const noun = AQ_PIPELINES[pipeline].noun;
  if (n) return { ok: false, reason: n + (n === 1 ? ` ${noun} is` : ` ${noun}s are`) + " in " + name + ". Move them first." };
  await saveAqStages(pipeline, cur.filter((x) => x !== name));
  stagesChanged();
  return { ok: true };
}
// ---------- the list pages' grid (one cell at a time) ----------
type CellResult = { ok: true; row?: Record<string, unknown> } | { ok: false; reason: string };
const PROPERTY_CELLS: Record<string, "text" | "state" | "assetType" | "number" | "int" | "date" | "deal" | "dealStage"> = {
  address: "text", city: "text", state: "state", county: "text", businessName: "text", assetType: "assetType", parcelId: "text", neighborhood: "text", notes: "text",
  acreage: "number", squareFeet: "int", yearBuilt: "int", lastSaleDate: "date", lastSalePrice: "number", askingPrice: "number", units: "int",
  deal: "deal", dealStage: "dealStage",
};
const COMPANY_CELLS: Record<string, "text" | "state" | "roles" | "name"> = { name: "name", website: "text", phone: "text", city: "text", state: "state", notes: "text", roles: "roles" };
const CONTACT_CELLS: Record<string, "text" | "email" | "roles" | "companyId" | "lines" | "int" | "date" | "callResult" | "operatorStatus" | "stage"> = {
  firstName: "text", lastName: "text", email: "email", emails: "lines", phone: "text", secondaryPhone: "text", otherPhones: "lines", mailingAddress: "text", notes: "text", roles: "roles", companyId: "companyId",
  operatorBrandName: "text", website: "text", operatorEntityName: "text", directoryOperatorName: "text", storePhone: "text", directoryOperatorPhone: "text", operatorTotalLocations: "int", operatorPipelineStatus: "operatorStatus", buyerStage: "stage", operatorStage: "stage",
  lastCallDate: "date", callResult: "callResult", callBackAt: "date", followUpAt: "date",
};
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
      if (t === "deal") {
        await setAqPropertyStages(id, text === "Deal" ? ["Deal"] : []);
        const p = await prisma.aqProperty.findUnique({ where: { id }, select: { dealStage: true, stages: true } });
        return { ok: true, row: { deal: parseJsonList(p?.stages).includes("Deal") ? "Deal" : null, dealStage: p?.dealStage ?? null } };
      }
      if (t === "dealStage") {
        if (!text) return { ok: false, reason: "Pick a stage, or clear the Call result instead." };
        await setAqDealStage(id, text);
        return { ok: true, row: { deal: "Deal", dealStage: text } };
      }
      const data: Record<string, unknown> = {};
      if (t === "text") data[key] = key === "address" ? text ?? "Property" : text;
      else if (t === "state") {
        const st = text?.toUpperCase().slice(0, 2) ?? null;
        if (st && !US_STATES[st]) return { ok: false, reason: `${text} is not a state code.` };
        data[key] = st;
      } else if (t === "assetType") {
        if (text && !(AQ_ASSET_TYPES as readonly string[]).includes(text)) return { ok: false, reason: `Asset type must be one of ${AQ_ASSET_TYPES.join(", ")}.` };
        data[key] = text;
      } else if (t === "number") data[key] = numOf(text);
      else if (t === "int") {
        const n = numOf(text);
        data[key] = n == null ? null : Math.round(n);
      } else if (t === "date") {
        const d = dayOf(text);
        if (text && !d) return { ok: false, reason: "Use a date." };
        data[key] = d;
      }
      await prisma.aqProperty.update({ where: { id }, data });
      revalidatePath(`/acquisitions/properties/${id}`);
      touchAll();
      return { ok: true, row: { [key]: data[key] instanceof Date ? (data[key] as Date).toISOString() : data[key] } };
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
    const data: Record<string, unknown> = {};
    if (t === "text") data[key] = text;
    else if (t === "email") data[key] = text?.toLowerCase() ?? null;
    else if (t === "lines") data[key] = lines(text).join("\n") || null;
    else if (t === "int") {
      const v = numOf(text);
      data[key] = v == null ? null : Math.round(v);
    } else if (t === "stage") {
      const pipeline = key === "buyerStage" ? "buyers" : "operators";
      if (text && !(await getAqStages(pipeline)).includes(text)) return { ok: false, reason: "Pick a stage from the list." };
      if (text) {
        await setAqContactStage(pipeline, id, text);
        const after = await prisma.aqContact.findUnique({ where: { id }, select: { roles: true } });
        return { ok: true, row: { [key]: text, roles: after?.roles ?? "[]" } };
      }
      data[key] = null;
    } else if (t === "operatorStatus") {
      if (text && !(AQ_OPERATOR_STATUSES as readonly string[]).includes(text)) return { ok: false, reason: `Operator Pipeline Status is one of ${AQ_OPERATOR_STATUSES.join(", ")}.` };
      data.operatorPipelineStatus = text;
    } else if (t === "callResult") {
      if (text && !(AQ_STAGES as readonly string[]).includes(text)) return { ok: false, reason: "Pick a call result from the list." };
      data.callResult = text;
      if (text) data.lastCallDate = new Date();
    } else if (t === "date") {
      const d = dayOf(text);
      if (text && !d) return { ok: false, reason: "Use a date." };
      data[key] = d;
      if (key === "callBackAt" && d) {
        const cur = await prisma.aqContact.findUnique({ where: { id }, select: { followUpAt: true, callBackAt: true } });
        data.callBackDismissedAt = null;
        if (!cur?.followUpAt || (cur.callBackAt && cur.followUpAt.getTime() === cur.callBackAt.getTime())) data.followUpAt = d;
      }
    }
    await prisma.aqContact.update({ where: { id }, data: await scrubJunkPhones(data) });
    revalidatePath(`/acquisitions/contacts/${id}`);
    touchAll();
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) row[k] = v instanceof Date ? v.toISOString() : v;
    return { ok: true, row };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

// ---------- transcripts and the map ----------
/** A call transcript pasted onto the property; the newest shows on top of the Transcript card. */
export async function deleteAqNote(target: NoteTarget, id: string) {
  await prisma.aqNote.deleteMany({ where: { id, ...(target.contactId ? { contactId: target.contactId } : { propertyId: target.propertyId }) } });
  revalidatePath(targetPath(target));
  touchAll();
}
type NoteTarget = { contactId?: string; propertyId?: string };
const targetPath = (t: NoteTarget) => (t.contactId ? `/acquisitions/contacts/${t.contactId}` : `/acquisitions/properties/${t.propertyId}`);
export async function addAqTranscript(target: NoteTarget, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await prisma.aqTranscript.create({ data: { contactId: target.contactId, propertyId: target.propertyId, body } });
  revalidatePath(targetPath(target));
}
export async function deleteAqTranscript(target: NoteTarget, id: string) {
  await prisma.aqTranscript.deleteMany({ where: { id, ...(target.contactId ? { contactId: target.contactId } : { propertyId: target.propertyId }) } });
  revalidatePath(targetPath(target));
}
/** Forget the map pin so the next page load looks the address up again. */
export async function recheckAqLocation(id: string) {
  await forgetAqGeo(id);
  revalidatePath(`/acquisitions/properties/${id}`);
}
/** The dashboard's Dismiss: this person's callback is done or no longer needed; the call result stays. */
export async function dismissCallBack(contactId: string) {
  await prisma.aqContact.update({ where: { id: contactId }, data: { callBackDismissedAt: new Date() } });
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
