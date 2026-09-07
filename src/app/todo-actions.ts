"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser, requireCriteriaAdmin } from "@/lib/current-user";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export async function addTodo(fd: FormData) {
  const text = s(fd, "text");
  if (!text) return;
  const due = s(fd, "dueDate");
  await prisma.todo.create({ data: { text, dueDate: due ? new Date(due) : null } });
  revalidatePath("/");
}

export async function toggleTodo(id: string) {
  const t = await prisma.todo.findUniqueOrThrow({ where: { id } });
  await prisma.todo.update({ where: { id }, data: { done: !t.done, doneAt: t.done ? null : new Date() } });
  revalidatePath("/");
}

export async function deleteTodo(id: string) {
  await prisma.todo.delete({ where: { id } });
  revalidatePath("/");
}

// ---------- investor criteria proposals (approve / dismiss from the To-do page) ----------
export async function approveProposal(id: string) {
  await requireCriteriaAdmin();
  const { applyProposal } = await import("@/lib/criteria-proposals");
  await applyProposal(id);
  revalidatePath("/");
}

export async function dismissProposal(id: string) {
  await requireCriteriaAdmin();
  const { rejectProposal } = await import("@/lib/criteria-proposals");
  await rejectProposal(id);
  revalidatePath("/");
}

/** "Respond now": build the follow-up draft in the sender's Outlook and hand back the link to open it. */
export async function openFollowUp(rowId: string) {
  const { createFollowUpDraft } = await import("@/lib/followup");
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const mailbox = me.email;
  try {
    const r = await createFollowUpDraft(rowId, mailbox);
    revalidatePath("/");
    return r;
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

export async function saveSignature(userId: string, fd: FormData) {
  const html = String(fd.get("signatureHtml") ?? "").trim();
  await prisma.user.update({ where: { id: userId }, data: { signatureHtml: html || null } });
  revalidatePath("/settings");
}
