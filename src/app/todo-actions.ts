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

/** "Handle": build the follow-up draft in the sender's Outlook and hand back the link to open it. */
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

/** Deal momentum "Handle": open a reply-all draft on the thread in question, empty body, your signature. */
export async function openMomentumDraft(momentumId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const m = await prisma.momentum.findUnique({ where: { id: momentumId } });
  if (!m) return { ok: false as const, reason: "Gone." };
  const { createThreadReplyDraft, createFollowUpDraft, replyToLatestWith } = await import("@/lib/followup");
  try {
    // 1) the exact thread we recorded, if it is in my mailbox
    if (m.lastMessageId) {
      const r = await createThreadReplyDraft(me.email, m.lastMessageId);
      if (r.ok) return r;
    }
    // 2) an LP on the deal's report: the normal deal follow-up
    if (m.contactId) {
      const row = await prisma.dealInvestor.findFirst({ where: { dealId: m.dealId, contactId: m.contactId } });
      if (row) return await createFollowUpDraft(row.id, me.email);
    }
    // 3) the person we are waiting on (sponsor contact, else the company's usual person): latest thread with them in MY mailbox, else a fresh email
    const deal = await prisma.deal.findUnique({ where: { id: m.dealId }, select: { propertyName: true, name: true, sponsorCompanyId: true } });
    let contact = m.contactId ? await prisma.contact.findUnique({ where: { id: m.contactId } }) : null;
    if (!contact?.email) {
      const { bestContactForCompany } = await import("@/lib/engagement");
      const cid = m.companyId ?? deal?.sponsorCompanyId ?? null;
      contact = cid ? await bestContactForCompany(cid) : null;
    }
    if (!contact?.email) return { ok: false as const, reason: `No email address on file for ${m.party}. Add one on their contact page.` };
    const dealName = deal?.propertyName ?? deal?.name ?? "";
    const words = dealName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return await replyToLatestWith(me.email, contact.email, `RE: ${dealName}`, words);
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

export async function dismissMomentum(id: string) {
  await prisma.momentum.update({ where: { id }, data: { status: "DISMISSED" } });
  revalidatePath("/");
}

// ---------- intros to reconsider ----------
/** Handle on an intro: reply-all on the latest message of that thread (from your mailbox), blank, with your signature. */
export async function openIntroDraft(introId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const intro = await prisma.intro.findUnique({ where: { id: introId } });
  if (!intro) return { ok: false as const, reason: "Gone." };
  const { createThreadReplyDraft } = await import("@/lib/followup");
  try {
    const r = await createThreadReplyDraft(me.email, intro.lastMessageId ?? intro.messageId);
    if (r.ok || me.email.toLowerCase() === intro.mailbox.toLowerCase()) return r;
    // the thread lives in a teammate's mailbox: start a fresh note to the same people instead
    const { createDraft, getMessage, outlookDesktopLink } = await import("@/lib/graph");
    const { signatureFor } = await import("@/lib/followup");
    const to = JSON.parse(intro.recipients || "[]") as string[];
    const draft = await createDraft(me.email, { subject: `RE: ${intro.subject}`, toRecipients: to, bodyHtml: `<html><body><div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;"><p><br></p>${await signatureFor(me.email)}</div></body></html>` });
    const fresh = await getMessage(me.email, draft.id, "id,webLink,internetMessageId");
    return { ok: true as const, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(me.email, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new" as const, attachments: 0 };
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

export async function dismissIntro(id: string) {
  await prisma.intro.update({ where: { id }, data: { status: "DISMISSED" } });
  revalidatePath("/");
}
