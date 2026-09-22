"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import type { Workspace } from "@/lib/access";
import { assistantTurn, attachmentText, parseSpreadsheet, runImport, type Attachment, type HistoryMessage, type ImportResult, type Proposal } from "@/lib/assistant";
import { saveDataRulesText } from "@/lib/data-rules";
import { saveReportRulesText } from "@/lib/report-rules";

export type { Workspace };
export type ThreadSummary = { id: string; title: string; updatedAt: string };
export type AttachmentSummary = { name: string; rows: number; truncated: boolean };
export type StoredMessage = { id?: string; role: "user" | "assistant"; content: string; lookups?: string[]; attachments?: AttachmentSummary[]; proposal?: Proposal | null; importedAt?: string | null; importResult?: ImportResult | null; savedRules?: string[] };

type MessageData = { attachments?: Attachment[]; proposal?: Proposal | null; importedAt?: string | null; importResult?: ImportResult | null; savedRules?: string[] };
const readData = (s: string | null): MessageData => {
  try {
    return s ? (JSON.parse(s) as MessageData) : {};
  } catch {
    return {};
  }
};

const who = async () => {
  const me = await currentUser();
  return { key: me?.id ?? "anon", name: me?.name ?? "the team" };
};

const toStored = (m: { id: string; role: string; content: string; lookups: string | null; data: string | null }): StoredMessage => {
  const d = readData(m.data);
  return { id: m.id, role: m.role as "user" | "assistant", content: m.content, lookups: m.lookups ? (JSON.parse(m.lookups) as string[]) : undefined, attachments: d.attachments?.map((a) => ({ name: a.name, rows: a.rows, truncated: a.truncated })), proposal: d.proposal ?? undefined, importedAt: d.importedAt ?? undefined, importResult: d.importResult ?? undefined, savedRules: d.savedRules };
};

/** Every conversation this person has had on this side, newest first. */
export async function listThreads(workspace: Workspace = "CA"): Promise<ThreadSummary[]> {
  const { key } = await who();
  const rows = await prisma.chatThread.findMany({ where: { userId: key, workspace }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, updatedAt: true } });
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

/** One conversation's messages (only the owner's). */
export async function loadThread(threadId: string): Promise<StoredMessage[]> {
  const { key } = await who();
  const t = await prisma.chatThread.findFirst({ where: { id: threadId, userId: key }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  return (t?.messages ?? []).map(toStored);
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * One turn: the text and any files. Files are read into text (every sheet as CSV) and kept with the message, so
 * the assistant still sees them on the next turns. The answer, any import proposal and any rules it saved are kept
 * with the reply.
 */
export async function chatAction(threadId: string | null, workspace: Workspace, fd: FormData): Promise<{ threadId: string; user: StoredMessage; assistant: StoredMessage }> {
  const { key, name } = await who();
  const text = String(fd.get("text") ?? "").trim();
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const attachments: Attachment[] = [];
  const problems: string[] = [];
  for (const f of files.slice(0, 6)) {
    if (f.size > MAX_FILE_BYTES) {
      problems.push(`${f.name} is over 15 MB`);
      continue;
    }
    try {
      attachments.push(parseSpreadsheet(f.name, Buffer.from(await f.arrayBuffer())));
    } catch (e) {
      problems.push(`${f.name} could not be read: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    }
  }
  const shown = text || (attachments.length ? `Here ${attachments.length === 1 ? "is a file" : "are files"}: ${attachments.map((a) => a.name).join(", ")}` : "");
  if (!shown) throw new Error("Nothing to send.");
  let thread = threadId ? await prisma.chatThread.findFirst({ where: { id: threadId, userId: key }, include: { messages: { orderBy: { createdAt: "asc" }, take: 60 } } }) : null;
  if (!thread) thread = await prisma.chatThread.create({ data: { userId: key, workspace, title: shown.replace(/\s+/g, " ").slice(0, 80) }, include: { messages: true } });

  // what the model sees: earlier turns (with their files, the most recent ones in full), then this one
  const history: HistoryMessage[] = [];
  let fileBudget = 240_000;
  const prior = [...thread.messages].reverse();
  const priorText: string[] = [];
  for (const m of prior) {
    const d = readData(m.data);
    let content = m.content;
    if (m.role === "user" && d.attachments?.length) {
      const t = d.attachments.map(attachmentText).join("\n\n");
      if (t.length <= fileBudget) {
        content += "\n\n" + t;
        fileBudget -= t.length;
      } else content += "\n\n" + d.attachments.map((a) => `[Attached earlier: ${a.name} (${a.rows} rows); ask for it again if you need the rows]`).join("\n");
    }
    if (m.role === "assistant" && d.proposal) content += `\n\n[You proposed an import: ${d.proposal.summary}${d.importedAt ? " (the user imported it)" : " (not imported yet)"}]`;
    priorText.unshift(content);
    history.unshift({ role: m.role as "user" | "assistant", content });
  }
  const own = shown + (attachments.length ? "\n\n" + attachments.map(attachmentText).join("\n\n") : "") + (problems.length ? "\n\n[Files not read: " + problems.join("; ") + "]" : "");
  history.push({ role: "user", content: own });

  const userRow = await prisma.chatMessage.create({ data: { threadId: thread.id, role: "user", content: shown, data: attachments.length ? JSON.stringify({ attachments }) : null } });
  let r: { answer: string; lookups: string[]; proposal: Proposal | null; savedRules: string[] };
  try {
    r = await assistantTurn(workspace, history, name);
  } catch (e) {
    r = { answer: `Something went wrong: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, lookups: [], proposal: null, savedRules: [] };
  }
  if (problems.length) r.answer = `${problems.join(". ")}.\n\n${r.answer}`;
  const data: MessageData = { proposal: r.proposal, savedRules: r.savedRules.length ? r.savedRules : undefined };
  const aRow = await prisma.chatMessage.create({ data: { threadId: thread.id, role: "assistant", content: r.answer, lookups: JSON.stringify(r.lookups), data: r.proposal || r.savedRules.length ? JSON.stringify(data) : null } });
  await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  return { threadId: thread.id, user: toStored(userRow), assistant: toStored(aRow) };
}

/** Import what an assistant reply proposed. Once. */
export async function importAction(messageId: string): Promise<{ ok: true; result: ImportResult; importedAt: string } | { ok: false; reason: string }> {
  const { key } = await who();
  const m = await prisma.chatMessage.findFirst({ where: { id: messageId, thread: { userId: key } }, include: { thread: { select: { workspace: true } } } });
  if (!m) return { ok: false, reason: "That reply is gone." };
  const d = readData(m.data);
  if (!d.proposal) return { ok: false, reason: "Nothing to import in that reply." };
  if (d.importedAt) return { ok: false, reason: "Already imported." };
  try {
    const result = await runImport(m.thread.workspace as Workspace, d.proposal);
    const importedAt = new Date().toISOString();
    await prisma.chatMessage.update({ where: { id: m.id }, data: { data: JSON.stringify({ ...d, importedAt, importResult: result }) } });
    for (const p of ["/acquisitions", "/acquisitions/properties", "/acquisitions/companies", "/acquisitions/contacts", "/acquisitions/pipeline", "/companies", "/contacts", "/israel/companies", "/israel/contacts"]) revalidatePath(p);
    return { ok: true, result, importedAt };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 300) };
  }
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

/** Settings > Data rules (RJL CA): the progress report rules, saved as typed; the next note, theme or item is written with them. */
export async function saveReportRulesAction(fd: FormData) {
  await saveReportRulesText(String(fd.get("text") ?? ""));
  revalidatePath("/settings/data-rules");
}

/** Settings > Data rules: the whole list, saved as typed. */
export async function saveDataRulesAction(workspace: Workspace, fd: FormData) {
  await saveDataRulesText(workspace, String(fd.get("text") ?? ""));
  for (const p of ["/settings/data-rules", "/israel/settings/data-rules", "/acquisitions/settings/data-rules"]) revalidatePath(p);
}
