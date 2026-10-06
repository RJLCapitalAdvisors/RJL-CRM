"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { syncProjectToUnits as syncUnits } from "@/lib/israel-sync";
import { IL_COMPANY_ROLES, IL_DEAL_STAGES, IL_ROLES, IL_SPONSOR, IL_SPONSOR_FOCUS, mergeIlRoles } from "@/lib/israel";
import { apartmentData, developersFromForm, houseData, i, list, n, projectData, s, yesNo } from "@/lib/israel-forms";

export async function createApartment(fd: FormData) {
  const a = await prisma.ilApartment.create({ data: apartmentData(fd) });
  revalidatePath("/israel/apartments");
  redirect(`/israel/apartments/${a.id}`);
}

export async function updateApartment(id: string, fd: FormData) {
  const data = apartmentData(fd);
  const before = await prisma.ilApartment.findUnique({ where: { id }, select: { priceNis: true } });
  const priceMoved = before != null && data.priceNis != null && data.priceNis !== before.priceNis;
  await prisma.ilApartment.update({ where: { id }, data: { ...data, ...(priceMoved ? { priceCheckedAt: new Date() } : {}) } }); // a new asking price is a pricing check
  if (data.projectId) await syncProjectToUnits(data.projectId);
  revalidatePath(`/israel/apartments/${id}`);
  revalidatePath("/israel/apartments");
}

/** The associations in the right column: developer (company), sales agent and seller (contacts). */
/** The developers ticked by name (the MultiSelect posts names): the first is the lead in developerId, all of them in developerIds. */
export async function linkApartment(id: string, fd: FormData) {
  const data: { developerId?: string | null; developerIds?: string | null; agentContactId?: string | null; sellerContactId?: string | null } = {};
  if (fd.has("developersSet")) Object.assign(data, await developersFromForm(fd));
  else if (fd.has("developerId")) data.developerId = s(fd, "developerId");
  if (fd.has("agentContactId")) data.agentContactId = s(fd, "agentContactId");
  if (fd.has("sellerContactId")) data.sellerContactId = s(fd, "sellerContactId");
  await prisma.ilApartment.update({ where: { id }, data });
  revalidatePath(`/israel/apartments/${id}`);
}

// ---------- houses ----------
export async function createHouse(fd: FormData) {
  const h = await prisma.ilHouse.create({ data: houseData(fd) });
  revalidatePath("/israel/houses");
  redirect(`/israel/houses/${h.id}`);
}
export async function updateHouse(id: string, fd: FormData) {
  const data = houseData(fd);
  const before = await prisma.ilHouse.findUnique({ where: { id }, select: { priceNis: true } });
  const priceMoved = before != null && data.priceNis != null && data.priceNis !== before.priceNis;
  await prisma.ilHouse.update({ where: { id }, data: { ...data, ...(priceMoved ? { priceCheckedAt: new Date() } : {}) } }); // a new asking price is a pricing check
  if (data.projectId) await syncProjectToUnits(data.projectId);
  revalidatePath(`/israel/houses/${id}`);
  revalidatePath("/israel/houses");
  if (data.projectId) revalidatePath(`/israel/projects/${data.projectId}`);
}
export async function linkHouse(id: string, fd: FormData) {
  const data: { developerId?: string | null; developerIds?: string | null; agentContactId?: string | null; sellerContactId?: string | null } = {};
  if (fd.has("developersSet")) Object.assign(data, await developersFromForm(fd));
  else if (fd.has("developerId")) data.developerId = s(fd, "developerId");
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
/**
 * What the project knows about its building fills the apartments and houses filed under it (Jonathan, Sep 17): total
 * units and total stories on every apartment, delivery on apartments and houses. Only blanks are filled; a unit's own
 * value, typed or extracted, stays.
 */
export async function syncProjectToUnits(projectId: string) {
  await syncUnits(projectId);
}
export async function createIlProject(fd: FormData) {
  const p = await prisma.ilProject.create({ data: await projectData(fd) });
  revalidatePath("/israel/projects");
  redirect(`/israel/projects/${p.id}`);
}
export async function updateIlProject(id: string, fd: FormData) {
  await prisma.ilProject.update({ where: { id }, data: await projectData(fd) });
  await syncProjectToUnits(id);
  revalidatePath(`/israel/projects/${id}`);
  revalidatePath("/israel/projects");
  revalidatePath("/israel/apartments");
  revalidatePath("/israel/houses");
}
/** The right column of a project: the broker who brought it. */
export async function linkProject(id: string, fd: FormData) {
  const data: { agentContactId?: string | null; developerId?: string | null; developerIds?: string | null } = {};
  if (fd.has("agentContactId")) data.agentContactId = s(fd, "agentContactId");
  if (fd.has("developersSet")) Object.assign(data, await developersFromForm(fd));
  await prisma.ilProject.update({ where: { id }, data });
  revalidatePath(`/israel/projects/${id}`);
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

/** Pricing updates window: the pricing on this ticket was checked with the agent or developer today; ask again in three months. */
export async function markPriceChecked(kind: "apartments" | "houses" | "projects", id: string) {
  const now = new Date();
  const body = "Pricing confirmed with the agent or developer; the dashboard asks again in three months.";
  if (kind === "apartments") {
    await prisma.ilApartment.update({ where: { id }, data: { priceCheckedAt: now } });
    await prisma.ilNote.create({ data: { apartmentId: id, body } });
  } else if (kind === "houses") {
    await prisma.ilHouse.update({ where: { id }, data: { priceCheckedAt: now } });
    await prisma.ilNote.create({ data: { houseId: id, body } });
  } else {
    await prisma.ilProject.update({ where: { id }, data: { priceCheckedAt: now } });
    await prisma.ilNote.create({ data: { projectId: id, body } });
  }
  revalidatePath("/israel");
  revalidatePath(`/israel/${kind}/${id}`);
}
