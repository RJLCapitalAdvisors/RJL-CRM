"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseList, toJson } from "@/lib/taxonomy";
import { syncContactRolesForCompany } from "@/lib/roles";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const list = (fd: FormData, k: string) => toJson(fd.getAll(k).map(String));
const num = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};

function companyData(fd: FormData) {
  return {
    name: s(fd, "name") ?? "(Unnamed company)",
    roles: list(fd, "roles"),
    domain: s(fd, "domain")?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") ?? null,
    website: s(fd, "website"),
    streetAddress: s(fd, "streetAddress"),
    city: s(fd, "city"),
    state: s(fd, "state"),
    yearFounded: num(fd, "yearFounded") ? Math.trunc(num(fd, "yearFounded")!) : null,
    notes: s(fd, "notes"),
    ownerId: s(fd, "ownerId"),
  };
}

function criteriaData(fd: FormData) {
  const openRaw = s(fd, "openToFunds");
  return {
    assetClasses: list(fd, "assetClasses"),
    checkSizes: list(fd, "checkSizes"),
    dealSizes: list(fd, "dealSizes"),
    investmentTypes: list(fd, "investmentTypes"),
    strategy: s(fd, "strategy"),
    geographies: toJson((s(fd, "geographies") ?? "").split(",").map((x) => x.trim())),
    geographyNotes: s(fd, "geographyNotes"),
    vintages: list(fd, "vintages"),
    openToFunds: openRaw == null ? null : openRaw === "yes",
    lenderPricing: s(fd, "lenderPricing"),
    aum: s(fd, "aum"),
    unitsManaged: s(fd, "unitsManaged"),
  };
}

export async function createCompany(fd: FormData) {
  const c = await prisma.company.create({ data: companyData(fd) });
  revalidatePath("/companies");
  redirect(`/companies/${c.id}`);
}

export async function updateCompany(id: string, fd: FormData) {
  const before = await prisma.company.findUnique({ where: { id }, select: { roles: true } });
  const data = companyData(fd);
  await prisma.company.update({ where: { id }, data });
  // Company roles flow down to its contacts (blasts are segmented by contact role).
  await syncContactRolesForCompany(id, parseList(before?.roles), parseList(data.roles));
  revalidatePath("/contacts");
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}

export async function updateCompanyCriteria(id: string, fd: FormData) {
  const data = criteriaData(fd);
  await prisma.investorCriteria.upsert({ where: { companyId: id }, create: { companyId: id, ...data }, update: data });
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}

export async function addCompanyNote(id: string, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await prisma.activity.create({ data: { type: "NOTE", body, companyId: id } });
  await prisma.company.update({ where: { id }, data: { lastActivityAt: new Date() } });
  revalidatePath(`/companies/${id}`);
}
