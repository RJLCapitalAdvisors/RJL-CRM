"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
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
  const { createThreadReplyDraft, createFollowUpDraft, replyToLatestWith, replyViaTeammateCopy, signatureFor } = await import("@/lib/followup");
  try {
    // LP request: a fresh email to the sponsor team listing what the investor asked for
    if (m.kind === "LP_ASK") {
      const { createDraft, getMessage, outlookDesktopLink } = await import("@/lib/graph");
      const { sponsorContactsFor } = await import("@/lib/engagement");
      const deal = await prisma.deal.findUnique({ where: { id: m.dealId }, select: { propertyName: true, name: true } });
      if (!deal) return { ok: false as const, reason: "Deal not found." };
      const people = await sponsorContactsFor(m.dealId);
      const to = people.map((p) => p.email);
      if (!to.length) return { ok: false as const, reason: "No sponsor contact found for this deal. Link the sponsor company on the deal ticket." };
      const firstName = people[0]?.firstName;
      const asks = m.summary.replace(/^.*?asks:\s*/, "").split(";").map((s) => s.trim()).filter(Boolean);
      const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
      const html = `<html><body><div style="${F}"><p style="margin:0 0 10pt 0;${F}">Hi${firstName ? ` ${firstName}` : ""} - hope you are well. ${m.party} came back on ${deal.propertyName ?? deal.name} with a few requests:</p><ul style="margin:0 0 10pt 18pt;">${asks.map((x) => `<li style="margin:0;${F}">${x}</li>`).join("")}</ul><p style="margin:0 0 10pt 0;${F}">Could you send these over when you get a chance and I will pass them along.</p>${await signatureFor(me.email)}</div></body></html>`;
      const draft = await createDraft(me.email, { subject: `${deal.propertyName ?? deal.name} | ${m.party} follow-up items`, toRecipients: to, bodyHtml: html });
      const fresh = await getMessage(me.email, draft.id, "id,webLink,internetMessageId");
      return { ok: true as const, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(me.email, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new" as const, attachments: 0 };
    }
    // 1) the exact thread we recorded: in my mailbox, else from a teammate's (or deals@) copy
    if (m.lastMessageId) {
      const r = await createThreadReplyDraft(me.email, m.lastMessageId);
      if (r.ok) return r;
      const t = await replyViaTeammateCopy(me.email, m.lastMessageId);
      if (t?.ok) return t;
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
  await prisma.intro.update({ where: { id: introId }, data: { handledAt: new Date() } }); // drops off once the reply shows in Sent Items
  const { createThreadReplyDraft, replyToLatestWith, replyViaTeammateCopy } = await import("@/lib/followup");
  try {
    // 1) the intro thread itself: in my mailbox, else from the teammate's copy who sent it
    for (const mid of [intro.lastMessageId, intro.messageId]) {
      if (!mid) continue;
      const r = await createThreadReplyDraft(me.email, mid);
      if (r.ok) return r;
    }
    for (const mid of [intro.lastMessageId, intro.messageId]) {
      if (!mid) continue;
      const t = await replyViaTeammateCopy(me.email, mid);
      if (t?.ok) return t;
    }
    // 2) the thread lives in a teammate mailbox: my latest thread with the people on the intro, else a fresh note to them
    const to = (JSON.parse(intro.recipients || "[]") as string[]).filter(Boolean);
    if (!to.length) return { ok: false as const, reason: "No outside recipients on that intro." };
    const words = [intro.partyA, intro.partyB].filter(Boolean).map((w) => String(w).toLowerCase());
    const first = await replyToLatestWith(me.email, to[0], `RE: ${intro.subject}`, words);
    if (first.ok && first.mode === "replyAll") return first;
    // nothing with them in my mailbox either: a fresh email to everyone who was on the intro
    const { createDraft, getMessage, outlookDesktopLink } = await import("@/lib/graph");
    const { signatureFor } = await import("@/lib/followup");
    if (first.ok && first.messageId) {
      // replyToLatestWith already made a fresh draft to the first person; swap it for one addressed to everyone
      const f = await graph(`/users/${encodeURIComponent(me.email)}/messages?$filter=internetMessageId eq '${first.messageId.replace(/'/g, "''")}'&$select=id`) as { value: { id: string }[] };
      if (f.value[0]) await graph(`/users/${encodeURIComponent(me.email)}/messages/${encodeURIComponent(f.value[0].id)}`, { method: "DELETE" }).catch(() => {});
    }
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
