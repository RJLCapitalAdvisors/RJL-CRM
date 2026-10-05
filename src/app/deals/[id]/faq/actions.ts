"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { stripDashes } from "@/lib/style";

const touch = (dealId: string) => {
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/faq`);
  revalidatePath(`/deals/${dealId}/send`);
};

/** A question or answer edited in place on the Investor FAQ page; saves as typed (Jonathan, Oct 5, 2026). */
export async function updateFactAction(dealId: string, factId: string, patch: { question?: string; answer?: string }): Promise<{ ok: boolean }> {
  const data: { question?: string; answer?: string } = {};
  if (patch.question != null) data.question = stripDashes(patch.question).trim().slice(0, 500);
  if (patch.answer != null) data.answer = stripDashes(patch.answer).trim().slice(0, 4000);
  const r = await prisma.dealFact.updateMany({ where: { id: factId, dealId }, data });
  touch(dealId);
  return { ok: r.count > 0 };
}

/** A new question and answer typed straight onto the FAQ. */
export async function addFactAction(dealId: string, question: string, answer: string): Promise<{ ok: boolean; id?: string }> {
  const q = stripDashes(question).trim(), a = stripDashes(answer).trim();
  if (!q || !a) return { ok: false };
  const last = await prisma.dealFact.findFirst({ where: { dealId }, orderBy: { position: "desc" }, select: { position: true } });
  const f = await prisma.dealFact.create({ data: { dealId, question: q.slice(0, 500), answer: a.slice(0, 4000), source: "typed on the FAQ page", inFaq: true, position: (last?.position ?? 0) + 1 } });
  touch(dealId);
  return { ok: true, id: f.id };
}

/** Erase a question for good. */
export async function removeFactAction(dealId: string, factId: string): Promise<{ ok: boolean }> {
  const r = await prisma.dealFact.deleteMany({ where: { id: factId, dealId } });
  touch(dealId);
  return { ok: r.count > 0 };
}

/** On the FAQ, or off it (the question stays on the ticket either way). */
export async function setFactFaqAction(dealId: string, factId: string, inFaq: boolean): Promise<{ ok: boolean }> {
  const r = await prisma.dealFact.updateMany({ where: { id: factId, dealId }, data: { inFaq } });
  touch(dealId);
  return { ok: r.count > 0 };
}

/** The order the FAQ reads in: the ids as they should run. */
export async function orderFactsAction(dealId: string, ids: string[]): Promise<{ ok: boolean }> {
  await prisma.$transaction(ids.map((id, i) => prisma.dealFact.updateMany({ where: { id, dealId }, data: { position: i + 1 } })));
  touch(dealId);
  return { ok: true };
}
