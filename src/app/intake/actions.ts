"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { extractDeal, missingItems, type ExtractedDeal, EMPTY } from "@/lib/intake";
import { detailsFromForm } from "@/components/checklist-fields";

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
  try {
    revalidatePath("/intake");
  } catch {
    // Called outside a request (webhook/script): nothing to revalidate.
  }
  return intake;
}

export async function submitPastedEmail(fd: FormData) {
  const rawText = s(fd, "rawText");
  if (!rawText) return;
  const attachments = (s(fd, "attachments") ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const intake = await processIntake({ rawText, subject: s(fd, "subject"), fromName: s(fd, "fromName"), fromEmail: s(fd, "fromEmail"), source: "PASTE", attachments });
  redirect(`/intake/${intake.id}`);
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

export async function convertIntakeToDeal(id: string) {
  const it = await prisma.dealIntake.findUniqueOrThrow({ where: { id } });
  if (it.dealId) redirect(`/deals/${it.dealId}`);
  const d = { ...EMPTY, ...(JSON.parse(it.extracted) as Partial<ExtractedDeal>) } as ExtractedDeal;
  const sponsor = d.sponsorName ? await prisma.company.findFirst({ where: { name: { contains: d.sponsorName } }, select: { id: true } }) : null;
  const propertyName = d.propertyName ?? it.subject ?? "New deal";
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
      ltv: d.ltv,
      loanTerm: d.loanTerm,
      equityMultiple: d.equityMultiple,
      occupancy: d.occupancy,
      sponsorExperience: d.sponsorExperience,
      summary: d.summary,
      details: JSON.stringify(d.details ?? {}),
    },
  });
  await prisma.activity.create({
    data: { type: "EMAIL", direction: "INBOUND", subject: it.subject ?? "Forwarded deal", body: it.rawText.slice(0, 4000), dealId: deal.id, companyId: sponsor?.id ?? null },
  });
  await prisma.dealIntake.update({ where: { id }, data: { status: "CONVERTED", dealId: deal.id } });
  revalidatePath("/intake");
  revalidatePath("/deals");
  redirect(`/deals/${deal.id}`);
}

export async function dismissIntake(id: string) {
  await prisma.dealIntake.update({ where: { id }, data: { status: "DISMISSED" } });
  revalidatePath("/intake");
  redirect("/intake");
}
