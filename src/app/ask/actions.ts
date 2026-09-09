"use server";

import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { askCrm, type ChatMessage } from "@/lib/ask-crm";

export type ThreadSummary = { id: string; title: string; updatedAt: string };
export type StoredMessage = { role: "user" | "assistant"; content: string; lookups?: string[] };

const who = async () => {
  const me = await currentUser();
  return { key: me?.id ?? "anon", name: me?.name ?? "the team" };
};

/** Every conversation this person has had, newest first. */
export async function listThreads(): Promise<ThreadSummary[]> {
  const { key } = await who();
  const rows = await prisma.chatThread.findMany({ where: { userId: key }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, updatedAt: true } });
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

/** One conversation's messages (only the owner's). */
export async function loadThread(threadId: string): Promise<StoredMessage[]> {
  const { key } = await who();
  const t = await prisma.chatThread.findFirst({ where: { id: threadId, userId: key }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  return (t?.messages ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content, lookups: m.lookups ? (JSON.parse(m.lookups) as string[]) : undefined }));
}

/** Ask, inside an existing conversation or a new one. The question and the answer are both kept. */
export async function askAction(threadId: string | null, question: string): Promise<{ threadId: string; answer: string; lookups: string[] }> {
  const { key, name } = await who();
  const text = question.trim();
  let thread = threadId ? await prisma.chatThread.findFirst({ where: { id: threadId, userId: key }, include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } } }) : null;
  if (!thread) thread = await prisma.chatThread.create({ data: { userId: key, title: text.replace(/\s+/g, " ").slice(0, 80) }, include: { messages: true } });
  const history: ChatMessage[] = [...thread.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user", content: text }];
  await prisma.chatMessage.create({ data: { threadId: thread.id, role: "user", content: text } });
  let r: { answer: string; lookups: string[] };
  try {
    r = await askCrm(history, name);
  } catch (e) {
    r = { answer: `Something went wrong: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, lookups: [] };
  }
  await prisma.chatMessage.create({ data: { threadId: thread.id, role: "assistant", content: r.answer, lookups: JSON.stringify(r.lookups) } });
  await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  return { threadId: thread.id, ...r };
}

export async function deleteThread(threadId: string) {
  const { key } = await who();
  await prisma.chatThread.deleteMany({ where: { id: threadId, userId: key } });
}

export async function renameThread(threadId: string, title: string) {
  const { key } = await who();
  const t = title.trim().slice(0, 80);
  if (!t) return;
  await prisma.chatThread.updateMany({ where: { id: threadId, userId: key }, data: { title: t } });
}
