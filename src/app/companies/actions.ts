"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { normalizeGeographies, parseList, toJson } from "@/lib/taxonomy";
import { syncContactRolesForCompany } from "@/lib/roles";
import { enrichCompany } from "@/lib/enrich";
import { currentUser } from "@/lib/current-user";
import { proposeManualChanges } from "@/lib/criteria-proposals";
import { checkBucketsFor, holdBucketsFor, vintageBucketsFor } from "@/lib/ranges";

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
    description: s(fd, "description"),
    phone: s(fd, "phone"),
    linkedin: s(fd, "linkedin"),
    streetAddress: s(fd, "streetAddress"),
    city: s(fd, "city"),
    state: s(fd, "state"),
    yearFounded: num(fd, "yearFounded") ? Math.trunc(num(fd, "yearFounded")!) : null,
    notes: s(fd, "notes"),
    ownerId: s(fd, "ownerId"),
  };
}

function criteriaData(fd: FormData) {
  const yn = (k: string) => {
    const v = s(fd, k);
    return v == null ? null : v === "yes";
  };
  const geoText = s(fd, "geographyNotes");
  const data: Record<string, unknown> = {
    assetClasses: list(fd, "assetClasses"),
  };
  // Only touch fields the submitted form actually carries (the sponsor form only has asset classes).
  if (fd.has("checkMin") || fd.has("geographyNotes")) {
    const range = (k: string): [number, number] | null => {
      const lo = num(fd, `${k}Min`), hi = num(fd, `${k}Max`);
      return lo != null && hi != null ? [lo, hi] : null;
    };
    const check = range("check"), hold = range("hold"), vint = range("vintage");
    Object.assign(data, {
      investmentTypes: list(fd, "investmentTypes"),
      checkMinMM: check?.[0] ?? null,
      checkMaxMM: check?.[1] ?? null,
      checkSizes: toJson(check ? checkBucketsFor(check[0], check[1]) : []),
      holdMinYears: hold?.[0] ?? null,
      holdMaxYears: hold?.[1] ?? null,
      holdPeriods: toJson(hold ? holdBucketsFor(hold[0], hold[1]) : []),
      vintageMin: vint?.[0] ?? null,
      vintageMax: vint?.[1] ?? null,
      vintages: toJson(vint ? vintageBucketsFor(vint[0], vint[1]) : []),
      geographyNotes: geoText,
      geographies: toJson(normalizeGeographies(geoText)),
      returnProfile: list(fd, "returnProfile"),
      strategy: s(fd, "strategy"),
      ozInterest: yn("ozInterest"),
      closingTimeframe: s(fd, "closingTimeframe"),
      openToMinority: yn("openToMinority"),
      otherInfo: s(fd, "otherInfo"),
    });
  }
  return data;
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
  const me = await currentUser();
  if (!me?.canEditCriteria) {
    // Not Jonathan: the edit becomes a proposal on his Home page instead of a direct change.
    await proposeManualChanges(id, data, me?.name ?? "A teammate");
    revalidatePath(`/companies/${id}`);
    revalidatePath("/");
    return;
  }
  await prisma.investorCriteria.upsert({ where: { companyId: id }, create: { companyId: id, ...data }, update: data });
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}

export async function addCompanyNote(id: string, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  await logActivity({ type: "NOTE", body, companyId: id });
  revalidatePath(`/companies/${id}`);
}

/** "Refresh from website": re-read the company's site and fill any blanks (never overwrites typed values). */
export async function refreshCompanyFromWebsite(id: string) {
  await enrichCompany(id, { force: true });
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}
