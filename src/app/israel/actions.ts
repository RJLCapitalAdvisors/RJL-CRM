"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { IL_COMPANY_ROLES, IL_DEAL_STAGES, IL_ROLES, IL_SPONSOR, IL_SPONSOR_FOCUS, mergeIlRoles } from "@/lib/israel";

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

/**
 * The mirpasot of an apartment or a house from the form. One mirpeset: the single size and direction fields.
 * More than one: a size and a direction per mirpeset, summed into mirpesetSqm and unioned into mirpesetDirection
 * so price per meter, filters and compare work on the totals.
 */
function mirpasotFrom(fd: FormData) {
  const count = i(fd, "mirpesetCount");
  if (!count || count <= 1) {
    const sukka = s(fd, "sukka");
    const single = { sqm: n(fd, "mirpesetSqm"), direction: fd.getAll("mirpesetDirection").map(String).filter(Boolean), sukka, sukkaSqm: sukka && sukka !== "No" ? n(fd, "sukkaSqm") : null, pool: null, poolSqm: null };
    return { mirpesetCount: count ?? (single.sqm != null ? 1 : null), mirpesetSqm: single.sqm, mirpesetDirection: JSON.stringify(single.direction), mirpasot: JSON.stringify(single.sqm != null || single.direction.length || single.sukka ? [single] : []) };
  }
  const sizes = fd.getAll("mirpasotSqm").map((v) => {
    const x = Number(String(v).replace(/[^0-9.]/g, ""));
    return String(v).trim() && !isNaN(x) ? x : null;
  });
  const items = Array.from({ length: Math.min(count, 3) }, (_, k) => {
    const sukka = s(fd, `mirpasotSukka_${k}`);
    return { sqm: sizes[k] ?? null, direction: fd.getAll(`mirpasotDir_${k}`).map(String).filter(Boolean), sukka, sukkaSqm: sukka && sukka !== "No" ? n(fd, `mirpasotSukkaSqm_${k}`) : null, pool: null, poolSqm: null };
  });
  const total = items.reduce((a, m) => a + (m.sqm ?? 0), 0);
  const dirs = [...new Set(items.flatMap((m) => m.direction))];
  return { mirpesetCount: count, mirpesetSqm: items.some((m) => m.sqm != null) ? total : null, mirpesetDirection: JSON.stringify(dirs), mirpasot: JSON.stringify(items) };
}
/** Ceiling heights typed one per floor or level, in the order the form shows them. */
function ceilingsFrom(fd: FormData, count: number | null) {
  const all = fd.getAll("ceilingCm").map((v) => {
    const x = Number(String(v).replace(/[^0-9.]/g, ""));
    return String(v).trim() && !isNaN(x) ? x : "";
  });
  return count ? all.slice(0, Math.max(0, count)) : all;
}

function apartmentData(fd: FormData) {
  const levels = i(fd, "levels");
  const ceilings = ceilingsFrom(fd, levels);
  const firstCeiling = ceilings.find((c): c is number => c !== "") ?? null;
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "Apartment"),
    apartmentType: s(fd, "apartmentType"),
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
    ...mirpasotFrom(fd),
    pool: s(fd, "pool"),
    poolSqm: s(fd, "pool") === "Yes" ? n(fd, "poolSqm") : null,
    // one level keeps the single ceiling; a duplex or triplex stores one per level and the first stands in for the single field
    levels,
    ceilingCms: JSON.stringify(levels && levels > 1 ? ceilings : []),
    ceilingCm: levels && levels > 1 ? firstCeiling : n(fd, "ceilingCm"),
    machsanSqm: n(fd, "machsanSqm"),
    machsanLocation: s(fd, "machsanLocation"),
    parkingSpots: s(fd, "parkingSpots"),
    direction: list(fd, "direction"),
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
  const ceilings = ceilingsFrom(fd, floors);
  return {
    name: s(fd, "name") ?? (s(fd, "street") || "House"),
    houseType: s(fd, "houseType"),
    projectId: s(fd, "projectId"),
    street: s(fd, "street"),
    city: s(fd, "city"),
    neighborhood: s(fd, "neighborhood"),
    rooms: n(fd, "rooms"),
    floors,
    ceilingCms: JSON.stringify(ceilings),
    completionDate: s(fd, "completionDate"),
    internalSqm: n(fd, "internalSqm"),
    ...mirpasotFrom(fd),
    migrashSqm: n(fd, "migrashSqm"),
    pool: s(fd, "housePool"),
    poolSqm: s(fd, "housePool") === "Yes" ? n(fd, "housePoolSqm") : null,
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
  const data = houseData(fd);
  await prisma.ilHouse.update({ where: { id }, data });
  revalidatePath(`/israel/houses/${id}`);
  revalidatePath("/israel/houses");
  if (data.projectId) revalidatePath(`/israel/projects/${data.projectId}`);
}
export async function linkHouse(id: string, fd: FormData) {
  const data: { developerId?: string | null; agentContactId?: string | null; sellerContactId?: string | null } = {};
  if (fd.has("developerId")) data.developerId = s(fd, "developerId");
  if (fd.has("agentContactId")) data.agentContactId = s(fd, "agentContactId");
  if (fd.has("sellerContactId")) data.sellerContactId = s(fd, "sellerContactId");
  await prisma.ilHouse.update({ where: { id }, data });
  revalidatePath(`/israel/houses/${id}`);
}
export async function approveHouse(id: string) {
  await (await import("@/lib/required-items")).loadIlRequired();
  const { houseMissing } = await import("@/lib/israel");
  const h = await prisma.ilHouse.findUnique({ where: { id } });
  if (!h || houseMissing(h as unknown as Record<string, unknown>).length) return;
  await prisma.ilHouse.update({ where: { id }, data: { pendingApproval: false } });
  revalidatePath("/israel");
  revalidatePath("/israel/houses");
  revalidatePath(`/israel/houses/${id}`);
}
/** A mentioned property we are not chasing: out of the Deals mentioned window and the funnel. */
export async function dismissIlMention(id: string) {
  await prisma.ilDeal.update({ where: { id }, data: { stage: "Lost", lostReason: "Mentioned, not pursued" } });
  revalidatePath("/israel");
  revalidatePath("/israel/deals");
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
  const roles = list(fd, "roles");
  const focus = s(fd, "sponsorFocus");
  return { name: s(fd, "name") ?? "Company", roles, sponsorFocus: roles.includes(IL_SPONSOR) && focus && (IL_SPONSOR_FOCUS as readonly string[]).includes(focus) ? focus : null, city: s(fd, "city"), website: s(fd, "website"), phone: s(fd, "phone"), notes: s(fd, "notes") };
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
export async function setIlCompanyRoles(id: string, roles: string[], focus: string | null = null) {
  const clean = (IL_COMPANY_ROLES as readonly string[]).filter((r) => roles.includes(r));
  const sponsorFocus = clean.includes(IL_SPONSOR) && focus && (IL_SPONSOR_FOCUS as readonly string[]).includes(focus) ? focus : null;
  await prisma.ilCompany.update({ where: { id }, data: { roles: JSON.stringify(clean), sponsorFocus } });
  await flowRolesToContacts(id, clean);
  revalidatePath(`/israel/companies/${id}`);
  revalidatePath("/israel/companies");
  revalidatePath("/israel/contacts");
}
export async function setIlContactRoles(id: string, roles: string[], _focus: string | null = null) {
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
    pool: s(fd, "pool"),
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
  await (await import("@/lib/required-items")).loadIlRequired();
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

/** "Other items" on a ticket: the answers to Required Items List questions with no field of their own. */
export async function saveIlExtra(kind: "projects" | "apartments" | "houses", id: string, fd: FormData) {
  const { loadIlRequired } = await import("@/lib/required-items");
  const { IL_REQUIRED, isCustomKey } = await import("@/lib/israel");
  await loadIlRequired();
  const o: Record<string, string> = {};
  for (const i of IL_REQUIRED[kind]) {
    if (!isCustomKey(i.key)) continue;
    const v = fd.get(i.key);
    if (typeof v === "string" && v.trim()) o[i.key] = v.trim();
  }
  const data = { extra: Object.keys(o).length ? JSON.stringify(o) : null };
  if (kind === "apartments") await prisma.ilApartment.update({ where: { id }, data });
  else if (kind === "houses") await prisma.ilHouse.update({ where: { id }, data });
  else await prisma.ilProject.update({ where: { id }, data });
  revalidatePath(`/israel/${kind}/${id}`);
  revalidatePath("/israel");
}

/** Deals mentioned: out of sight for a week, then back on the dashboard (Dismiss is for good). */
export async function snoozeIlMention(id: string) {
  await prisma.ilDeal.update({ where: { id }, data: { snoozedUntil: new Date(Date.now() + 7 * 86_400_000) } });
  revalidatePath("/israel");
}

/** The map card's "check again": forget the pin so the next page load looks the address up afresh. */
export async function recheckIlLocation(kind: "apartments" | "houses" | "projects", id: string) {
  const { forgetGeo } = await import("@/lib/geocode");
  await forgetGeo(kind, id);
  revalidatePath(`/israel/${kind}/${id}`);
}
