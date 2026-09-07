"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

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
  const { applyProposal } = await import("@/lib/criteria-proposals");
  await applyProposal(id);
  revalidatePath("/");
}

export async function dismissProposal(id: string) {
  const { rejectProposal } = await import("@/lib/criteria-proposals");
  await rejectProposal(id);
  revalidatePath("/");
}

/** "Respond now" was clicked: the follow-up is open in Outlook, so record the LP as Followed Up. */
export async function markFollowedUp(rowId: string) {
  const { setTrackerStatus } = await import("@/app/deals/[id]/tracker/actions");
  await setTrackerStatus(rowId, 3);
  revalidatePath("/");
}
