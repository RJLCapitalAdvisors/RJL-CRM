"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEAL_STAGES } from "@/lib/taxonomy";
import { parseDetails } from "@/lib/checklist";
import { detailsFromForm } from "@/components/checklist-fields";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};
const date = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

export async function moveDeal(id: string, stage: string) {
  if (!(DEAL_STAGES as readonly string[]).includes(stage)) throw new Error("Unknown stage");
  await prisma.deal.update({ where: { id }, data: { stage } });
  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  revalidatePath("/");
}

async function dealData(fd: FormData) {
  const sponsorName = s(fd, "sponsorName");
  const propertyName = s(fd, "propertyName");
  const onMarket = s(fd, "onMarket");
  let sponsorCompanyId = s(fd, "sponsorCompanyId");
  if (!sponsorCompanyId && sponsorName) {
    const match = await prisma.company.findFirst({ where: { name: sponsorName }, select: { id: true } });
    sponsorCompanyId = match?.id ?? null;
  }
  const name = s(fd, "name") ?? ([sponsorName, propertyName].filter(Boolean).join(" | ") || "(Unnamed deal)");
  const stage = s(fd, "stage") ?? "Deal Received";
  return {
    name,
    stage: (DEAL_STAGES as readonly string[]).includes(stage) ? stage : "Deal Received",
    sponsorName,
    sponsorCompanyId,
    propertyName,
    propertyAddress: s(fd, "propertyAddress"),
    city: s(fd, "city"),
    state: s(fd, "state"),
    assetClass: s(fd, "assetClass"),
    strategy: s(fd, "strategy"),
    onMarket: onMarket == null ? null : onMarket === "on",
    requestType: s(fd, "requestType"),
    requestedAmount: num(fd, "requestedAmount"),
    totalEquity: num(fd, "totalEquity"),
    purchasePrice: num(fd, "purchasePrice"),
    ltv: num(fd, "ltv"),
    loanTerm: s(fd, "loanTerm"),
    equityMultiple: num(fd, "equityMultiple"),
    occupancy: num(fd, "occupancy"),
    sponsorExperience: s(fd, "sponsorExperience"),
    summary: s(fd, "summary"),
    closeDate: date(fd, "closeDate"),
    ownerId: s(fd, "ownerId"),
  };
}

export async function createDeal(fd: FormData) {
  const d = await prisma.deal.create({ data: await dealData(fd) });
  revalidatePath("/deals");
  redirect(`/deals/${d.id}`);
}

export async function updateDeal(id: string, fd: FormData) {
  await prisma.deal.update({ where: { id }, data: await dealData(fd) });
  revalidatePath(`/deals/${id}`);
  revalidatePath("/deals");
}

export async function addDealNote(id: string, fd: FormData) {
  const body = s(fd, "body");
  if (!body) return;
  const deal = await prisma.deal.findUnique({ where: { id }, select: { sponsorCompanyId: true } });
  await prisma.activity.create({ data: { type: "NOTE", body, dealId: id, companyId: deal?.sponsorCompanyId ?? null } });
  revalidatePath(`/deals/${id}`);
}

export async function updateDealDetails(id: string, fd: FormData) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id }, select: { details: true } });
  const details = detailsFromForm(fd, parseDetails(deal.details));
  await prisma.deal.update({ where: { id }, data: { details: JSON.stringify(details) } });
  revalidatePath(`/deals/${id}`);
}
