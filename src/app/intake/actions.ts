"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { extractDeal, missingItems, type ExtractedDeal, EMPTY, applyDealRules } from "@/lib/intake";
import { detailsFromForm } from "@/components/checklist-fields";
import { contactForEmail, domainOf } from "@/lib/domains";
import { syncContactRolesForCompany } from "@/lib/roles";
import { parseList, toJson } from "@/lib/taxonomy";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export async function processIntake(input: { rawText: string; subject?: string | null; fromName?: string | null; fromEmail?: string | null; toEmail?: string | null; source: "PASTE" | "WEBHOOK"; attachments?: string[] }) {
  let extracted: ExtractedDeal = EMPTY;
  let extractor = "none";
  let notes: string | null = null;
  try {
    const r = await extractDeal(input.rawText, input.subject, input.fromName, input.fromEmail, input.attachments ?? []);
    extracted = r.data;
    extractor = r.extractor;
    notes = r.data.confidenceNotes;
  } catch (e) {
    notes = `Extraction failed: ${String(e).slice(0, 300)}`;
  }
  const intake = await prisma.dealIntake.create({
    data: {
      source: input.source,
      fromEmail: input.fromEmail ?? null,
      fromName: input.fromName ?? null,
      toEmail: input.toEmail ?? null,
      subject: input.subject ?? null,
      rawText: input.rawText,
      attachments: JSON.stringify(input.attachments ?? []),
      extracted: JSON.stringify(extracted),
      missing: JSON.stringify(missingItems(extracted)),
      notes,
      extractor,
    },
  });
  // No review step: a forwarded deal becomes a deal right away (Deal Received). The intake record keeps the original email.
  const dealId = await createDealFromIntake(intake.id);
  try {
    revalidatePath("/intake");
  } catch {
    // Called outside a request (webhook/script): nothing to revalidate.
  }
  return { ...intake, dealId };
}

export async function submitPastedEmail(fd: FormData) {
  const rawText = s(fd, "rawText");
  if (!rawText) return;
  const attachments = (s(fd, "attachments") ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const intake = await processIntake({ rawText, subject: s(fd, "subject"), fromName: s(fd, "fromName"), fromEmail: s(fd, "fromEmail"), source: "PASTE", attachments });
  redirect(`/deals/${intake.dealId}`);
}

export async function reprocessIntake(id: string) {
  const it = await prisma.dealIntake.findUniqueOrThrow({ where: { id } });
  const r = await extractDeal(it.rawText, it.subject, it.fromName, it.fromEmail, JSON.parse(it.attachments || "[]"));
  await prisma.dealIntake.update({
    where: { id },
    data: { extracted: JSON.stringify(r.data), missing: JSON.stringify(missingItems(r.data)), extractor: r.extractor, notes: r.data.confidenceNotes },
  });
  revalidatePath(`/intake/${id}`);
}

/** Save manual corrections to the extracted fields and checklist answers. */
export async function updateExtracted(id: string, fd: FormData) {
  const it = await prisma.dealIntake.findUniqueOrThrow({ where: { id } });
  const cur = { ...EMPTY, ...(JSON.parse(it.extracted) as Partial<ExtractedDeal>) } as ExtractedDeal;
  const num = (k: string) => {
    const v = s(fd, k);
    if (v == null) return null;
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? null : n;
  };
  const onMarket = s(fd, "onMarket");
  const next: ExtractedDeal = {
    ...cur,
    sponsorName: s(fd, "sponsorName"),
    propertyName: s(fd, "propertyName"),
    propertyAddress: s(fd, "propertyAddress"),
    city: s(fd, "city"),
    state: s(fd, "state"),
    assetClass: s(fd, "assetClass"),
    strategy: (s(fd, "strategy") as ExtractedDeal["strategy"]) ?? null,
    requestType: (s(fd, "requestType") as ExtractedDeal["requestType"]) ?? null,
    requestedAmount: num("requestedAmount"),
    purchasePrice: num("purchasePrice"),
    totalEquity: num("totalEquity"),
    ltv: num("ltv"),
    loanTerm: s(fd, "loanTerm"),
    equityMultiple: num("equityMultiple"),
    occupancy: num("occupancy"),
    onMarket: onMarket == null ? null : onMarket === "on",
    sponsorExperience: s(fd, "sponsorExperience"),
    summary: s(fd, "summary"),
    details: detailsFromForm(fd, (cur.details ?? {}) as Record<string, string | null>) as ExtractedDeal["details"],
  };
  await prisma.dealIntake.update({ where: { id }, data: { extracted: JSON.stringify(next), missing: JSON.stringify(missingItems(next)) } });
  revalidatePath(`/intake/${id}`);
}

/** Create the deal from an intake record. Returns the deal id (existing one if already converted). */
export async function createDealFromIntake(id: string): Promise<string> {
  const it = await prisma.dealIntake.findUniqueOrThrow({ where: { id } });
  if (it.dealId) return it.dealId;
  const d = applyDealRules({ ...EMPTY, ...(JSON.parse(it.extracted) as Partial<ExtractedDeal>) } as ExtractedDeal);
  const sponsor = d.sponsorName ? await prisma.company.findFirst({ where: { name: { contains: d.sponsorName } }, select: { id: true } }) : null;
  const propertyName = d.propertyName ?? it.subject ?? "New deal";
  // one deal, one ticket: if we already track this deal, attach the intake to it instead of creating another
  const { findSameDeal } = await import("@/lib/deal-knowledge");
  const same = await findSameDeal(propertyName);
  if (same) {
    await prisma.dealIntake.update({ where: { id }, data: { dealId: same.id, status: "CONVERTED", notes: `Matched existing deal ${same.name}` } }).catch(() => null);
    return same.id;
  }
  const deal = await prisma.deal.create({
    data: {
      name: d.sponsorName ? `${d.sponsorName} | ${propertyName}` : propertyName,
      stage: "Deal Received",
      sponsorName: d.sponsorName,
      sponsorCompanyId: sponsor?.id ?? null,
      propertyName,
      propertyAddress: d.propertyAddress,
      city: d.city,
      state: d.state,
      assetClass: d.assetClass,
      strategy: d.strategy,
      onMarket: d.onMarket,
      requestType: d.requestType,
      requestedAmount: d.requestedAmount,
      purchasePrice: d.purchasePrice,
      totalEquity: d.totalEquity,
      loanTerm: d.loanTerm,
      equityMultiple: d.equityMultiple,
      occupancy: d.occupancy,
      sponsorExperience: d.sponsorExperience,
      summary: d.summary,
      details: JSON.stringify(d.details ?? {}),
      units: d.units != null ? Math.trunc(d.units) : null,
      squareFeet: d.squareFeet,
      yearBuilt: d.yearBuilt,
      unitMix: d.unitMix,
      totalCapitalization: d.totalCapitalization,
      totalDebt: d.totalDebt,
      executionType: d.executionType,
      interestRate: d.interestRate,
      lenderType: d.lenderType,
      irr: d.irr,
      capRateT12: d.capRateT12,
      capRateY1: d.capRateY1,
      yieldOnCost: d.yieldOnCost,
      cashOnCash: d.cashOnCash,
      holdPeriod: d.holdPeriod,
      expectedClose: d.expectedClose,
      amortization: d.amortization,
      // developments are quoted on cost, not value
      ltc: d.strategy === "Development" ? d.ltv : null,
      ltv: d.strategy === "Development" ? null : d.ltv,
    },
  });
  // The person who sent the deal: find or create the contact, tie them to their email-domain company,
  // mark that company (and its people) as a Sponsor, and use it as the deal's sponsor if we had no match.
  let senderContactId: string | null = null;
  let sponsorCompanyId = sponsor?.id ?? null;
  const senderEmail = d.contactEmail ?? it.fromEmail;
  if (senderEmail && domainOf(senderEmail)) {
    const contact = await contactForEmail(senderEmail, { name: d.contactName ?? it.fromName, companyNameHint: d.sponsorName, extraRoles: ["Sponsor"] });
    senderContactId = contact.id;
    if (contact.company) {
      const roles = parseList(contact.company.roles);
      if (!roles.includes("Sponsor")) {
        await prisma.company.update({ where: { id: contact.company.id }, data: { roles: toJson([...roles, "Sponsor"]) } });
        await syncContactRolesForCompany(contact.company.id, roles, [...roles, "Sponsor"]);
      }
      if (!sponsorCompanyId) {
        sponsorCompanyId = contact.company.id;
        await prisma.deal.update({ where: { id: deal.id }, data: { sponsorCompanyId, sponsorName: d.sponsorName ?? contact.company.name } });
      }
    }
  }
  await logActivity({ type: "EMAIL", direction: "INBOUND", subject: it.subject ?? "Forwarded deal", body: it.rawText.slice(0, 4000), dealId: deal.id, companyId: sponsorCompanyId, contactId: senderContactId });
  await prisma.dealIntake.update({ where: { id }, data: { status: "CONVERTED", dealId: deal.id } });
  try {
    revalidatePath("/intake");
    revalidatePath("/deals");
    revalidatePath("/");
  } catch {
    // outside a request
  }
  return deal.id;
}

export async function convertIntakeToDeal(id: string) {
  const dealId = await createDealFromIntake(id);
  redirect(`/deals/${dealId}`);
}

export async function dismissIntake(id: string) {
  await prisma.dealIntake.update({ where: { id }, data: { status: "DISMISSED" } });
  revalidatePath("/intake");
  redirect("/intake");
}
