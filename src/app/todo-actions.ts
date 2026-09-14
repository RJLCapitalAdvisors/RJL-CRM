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
/** Handle on Deal momentum: the draft, and a note of the click so the item closes once the email goes out. */
export async function openMomentumDraft(momentumId: string) {
  const r = await openMomentumDraftInner(momentumId);
  if (r.ok) {
    const me = await currentUser();
    if (me) await prisma.momentum.update({ where: { id: momentumId }, data: { handledAt: new Date(), handledBy: me.email } }).catch(() => null);
  }
  return r;
}
async function openMomentumDraftInner(momentumId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const m = await prisma.momentum.findUnique({ where: { id: momentumId } });
  if (!m) return { ok: false as const, reason: "Gone." };
  const { createThreadReplyDraft, createFollowUpDraft, replyToLatestWith, replyViaTeammateCopy, signatureFor } = await import("@/lib/followup");
  try {
    // LP request: reply-all on my latest thread with the sponsor about this deal, the asks written on top
    if (m.kind === "LP_ASK") {
      const { createDraft, createReplyAllDraft, getMessage, outlookDesktopLink, updateDraftBody } = await import("@/lib/graph");
      const { sponsorContactsFor } = await import("@/lib/engagement");
      const deal = await prisma.deal.findUnique({ where: { id: m.dealId }, include: { sponsorCompany: { select: { domain: true } } } });
      if (!deal) return { ok: false as const, reason: "Deal not found." };
      const people = await sponsorContactsFor(m.dealId);
      const to = people.map((p) => p.email);
      if (!to.length) return { ok: false as const, reason: "No sponsor contact found for this deal. Link the sponsor company on the deal ticket." };
      const firstName = people[0]?.firstName;
      const dealName = deal.propertyName ?? deal.name;
      const asks = m.summary.replace(/^.*?asks:\s*/, "").split(" | Already on the ticket:")[0].split(";").map((s) => s.trim()).filter(Boolean);
      const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
      // the LP's actual email: their words go in, their attachments come along
      const { findMessageCopy, lpOwnWords } = await import("@/lib/lp-message");
      const lp = m.lastMessageId ? await findMessageCopy(m.lastMessageId, me.email).catch(() => null) : null;
      const lpText = lp ? lpOwnWords(lp.body) : "";
      const lpWhen = lp?.receivedDateTime ? new Date(lp.receivedDateTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
      // the quote is attributed to the firm, never to the individual (their name and signature stay out of the sponsor's inbox)
      const lpFrom = m.party.replace(/\s*\([^)]*\)\s*$/, "");
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const opening = `Hi${firstName ? ` ${firstName}` : ""} - please also see the below requests from ${m.party} on ${dealName}:`;
      const closing = "Could you send these over when you get a chance and I will pass them along.";
      const quote = lpText ? `<p style="margin:0 0 4pt 0;${F}"><i>From ${esc(lpFrom)}${lpWhen ? `, ${lpWhen}` : ""}:</i></p><div style="margin:0 0 10pt 0;padding:4pt 10pt;border-left:3px solid #b7cfe8;${F}white-space:pre-wrap;">${esc(lpText)}</div>` : "";
      const block = `<div style="${F}"><p style="margin:0 0 10pt 0;${F}">${opening}</p><ul style="margin:0 0 10pt 18pt;">${asks.map((x) => `<li style="margin:0;${F}">${esc(x)}</li>`).join("")}</ul>${quote}<p style="margin:0 0 10pt 0;${F}">${closing}</p>`;
      const { addAttachment, listAttachments, graph: g } = await import("@/lib/graph");
      const carryAttachments = async (draftId: string) => {
        if (!lp?.hasAttachments) return 0;
        const atts = await listAttachments(lp.box, lp.id).catch(() => []);
        let n = 0;
        for (const a of atts) {
          if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment" || /\.(png|jpe?g|gif|bmp)$/i.test(a.name)) continue;
          try {
            const bytes = new Uint8Array(await g<ArrayBuffer>(`/users/${encodeURIComponent(lp.box)}/messages/${encodeURIComponent(lp.id)}/attachments/${encodeURIComponent(a.id)}/$value`, { raw: true }));
            await addAttachment(me.email, draftId, { name: a.name, contentType: a.contentType ?? "application/octet-stream", bytes });
            n++;
          } catch {
            /* one attachment failing does not stop the draft */
          }
        }
        return n;
      };
      // the conversation to build on: the ongoing sponsor-only thread about this deal (by its words, not its subject),
      // else the ongoing sponsor-only conversation that is not about another deal. Never an intro, never a third party.
      const { sponsorThreadFor } = await import("@/lib/sponsor-thread");
      const thread = await sponsorThreadFor(me.email, { id: deal.id, name: deal.name, propertyName: deal.propertyName, city: deal.city, state: deal.state, sponsorCompanyId: deal.sponsorCompanyId, requestedAmount: deal.requestedAmount }, { emails: to, domain: deal.sponsorCompany?.domain ?? null }).catch(() => null);
      const original = thread ? { id: thread.messageId } : null;
      const replyDraft = original ? await createReplyAllDraft(me.email, original.id).catch(() => null) : null; // a message Outlook will not reply to (a draft, a deleted item) falls through to a fresh email
      if (original && replyDraft) {
        const draft = replyDraft;
        const body = draft.body?.content ?? "";
        const at = body.search(/<body[^>]*>/i);
        const html = at >= 0 ? body.replace(/(<body[^>]*>)/i, `$1${block}${await signatureFor(me.email)}<br></div>`) : `${block}${await signatureFor(me.email)}</div>${body}`;
        await updateDraftBody(me.email, draft.id, html);
        const attachments = await carryAttachments(draft.id);
        const fresh = await getMessage(me.email, draft.id, "id,webLink,internetMessageId");
        // the server draft is what opens (it carries the LP's words and files); Outlook building its own reply would lose them
        return { ok: true as const, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(me.email, draft.id), messageId: fresh.internetMessageId ?? null, mode: "replyAll" as const, attachments };
      }
      const draft = await createDraft(me.email, { subject: `${dealName} | ${m.party} follow-up items`, toRecipients: to, bodyHtml: `<html><body>${block}${await signatureFor(me.email)}</div></body></html>` });
      const attachments = await carryAttachments(draft.id);
      const fresh = await getMessage(me.email, draft.id, "id,webLink,internetMessageId");
      return { ok: true as const, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(me.email, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new" as const, attachments };
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
  const r = await openIntroDraftInner(introId);
  if (r.ok) await prisma.intro.update({ where: { id: introId }, data: { handledAt: new Date() } }).catch(() => null); // marked handled; drops off once the reply shows in Sent Items
  return r;
}

async function openIntroDraftInner(introId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const intro = await prisma.intro.findUnique({ where: { id: introId } });
  if (!intro) return { ok: false as const, reason: "Gone." };
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

/** Take quiet LPs off the LP follow-ups window. They stay on the progress report at their status; only the nudge goes away. */
export async function dismissFollowUps(rowIds: string[]) {
  if (!rowIds.length) return;
  await prisma.dealInvestor.updateMany({ where: { id: { in: rowIds } }, data: { followUpDismissedAt: new Date() } });
  revalidatePath("/");
}

// ---------- culling quiet deals (Data updates) ----------
/** Jonathan approves: the deal goes to Deal Lost, which takes it off Deal momentum and LP follow-ups. */
export async function markDealLostAction(dealId: string) {
  await requireCriteriaAdmin();
  await markLost(dealId, "Marked Deal Lost from Data updates after going quiet");
}
/** From Ready for launch: anyone on the team can call a deal. Same effect as dragging it to Deal Lost on the board. */
export async function markDealLostFromLaunchAction(dealId: string) {
  await markLost(dealId, "Marked Deal Lost from Ready for launch");
}
/**
 * Deal Lost clears the deal from the pipeline and the dashboard: off the live board columns, LP follow-ups,
 * Deal momentum (its open items close), Ready for launch and the culling list. Intros to reconsider are untouched:
 * an intro made along the way keeps its own life.
 */
async function markLost(dealId: string, why: string) {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { stage: true } });
  if (!d || d.stage === "Deal Lost") return;
  await prisma.deal.update({ where: { id: dealId }, data: { stage: "Deal Lost", closedLostReason: `${why} (was ${d.stage})`, reportDraftId: null, reportDraftMailbox: null, reportDraftAt: null } });
  await prisma.momentum.updateMany({ where: { dealId, status: "OPEN" }, data: { status: "DONE" } });
  await prisma.activity.create({ data: { type: "NOTE", body: `${why} (was ${d.stage}).`, dealId, occurredAt: new Date() } }).catch(() => null);
  revalidatePath("/");
  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
}
/** Not dead yet: hide it from the culling list until it has been quiet for another stretch. */
export async function keepDealAction(dealId: string) {
  await requireCriteriaAdmin();
  await prisma.deal.update({ where: { id: dealId }, data: { staleCheckedAt: new Date(), updatedAt: new Date() } });
  revalidatePath("/");
}

// ---------- possible duplicates (Data updates) ----------
export async function mergeDealsAction(fromId: string, intoId: string) {
  await requireCriteriaAdmin();
  const { mergeDeals } = await import("@/lib/deal-dedupe");
  await mergeDeals(fromId, intoId);
  revalidatePath("/");
  revalidatePath("/deals");
  revalidatePath(`/deals/${intoId}`);
}
export async function notDuplicateAction(aId: string, bId: string) {
  await requireCriteriaAdmin();
  const { markNotDuplicate } = await import("@/lib/deal-dedupe");
  await markNotDuplicate(aId, bId);
  revalidatePath("/");
}

/**
 * Handle on a deal gone quiet (Data updates): open a check-in to whoever the deal came through, on the thread it
 * lives on. A mentioned deal replies on the email that mentioned it (often the intro); otherwise the ongoing
 * sponsor-only conversation about the deal; otherwise the latest thread with the sponsor contact; otherwise fresh.
 */
/** Handle on a quiet deal: the check-in draft, and a note of the click so the deal leaves Data updates once it goes out. */
export async function handleStaleDeal(dealId: string) {
  const r = await handleStaleDealInner(dealId);
  if (r.ok) {
    const me = await currentUser();
    if (me) await prisma.deal.update({ where: { id: dealId }, data: { staleHandledAt: new Date(), staleHandledBy: me.email } }).catch(() => null);
  }
  return r;
}
async function handleStaleDealInner(dealId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { sponsorCompany: { select: { id: true, name: true, domain: true, roles: true } }, _count: { select: { investors: true } } } });
  if (!deal) return { ok: false as const, reason: "Deal not found." };
  const dealName = deal.propertyName ?? deal.name;
  const { createThreadReplyDraft, replyViaTeammateCopy, replyToLatestWith, signatureFor } = await import("@/lib/followup");
  const { sponsorContactsFor, bestContactForCompany } = await import("@/lib/engagement");
  const people = await sponsorContactsFor(dealId).catch(() => [] as { email: string; firstName: string | null }[]);
  const first = people[0]?.firstName?.trim();
  const greeting = `Hi${first ? ` ${first}` : ""} - checking in on ${dealName}. Any update on your end?`;
  let details: { mentionedIn?: string; mentionedMessageId?: string } = {};
  try {
    details = JSON.parse(deal.details || "{}");
  } catch {
    /* no details */
  }
  try {
    // 0) a legacy HubSpot intro record ("Matador | Boos Development"): the deal IS the intro. Reply on the intro
    //    email that connected the two, never on some other thread with the firm in the sponsor slot.
    const { isLegacyIntroTicket } = await import("@/lib/taxonomy");
    if (isLegacyIntroTicket({ ...deal, sponsorRoles: deal.sponsorCompany?.roles ?? null, investorCount: deal._count.investors })) {
      const partyA = (deal.sponsorName ?? "").split(/[|(]/)[0].trim();
      const partyB = (deal.propertyName ?? "").split(/[|(]/)[0].trim();
      const introGreeting = "Hi all - checking in on this intro. Did you manage to connect, and is there anything I can help move along?";
      const intro = partyA && partyB ? await prisma.intro.findFirst({ where: { AND: [{ subject: { contains: partyA, mode: "insensitive" } }, { subject: { contains: partyB, mode: "insensitive" } }] }, orderBy: { lastActivityAt: "desc" } }) : null;
      if (intro) {
        for (const mid of [intro.lastMessageId, intro.messageId].filter((x): x is string => Boolean(x))) {
          const r = await createThreadReplyDraft(me.email, mid, introGreeting);
          if (r.ok) return r;
          const t = await replyViaTeammateCopy(me.email, mid);
          if (t?.ok) return t;
        }
      }
      // no scanned intro: my Sent Items, an "Intro" subject naming both firms
      const { graph: g, createReplyAllDraft, getMessage, outlookDesktopLink, updateDraftBody } = await import("@/lib/graph");
      const sent = (await g<{ value: { id: string; subject: string | null; sentDateTime?: string }[] }>(`/users/${encodeURIComponent(me.email)}/mailFolders/sentitems/messages?$search=${encodeURIComponent('"subject:Intro"')}&$top=60&$select=id,subject,sentDateTime`).catch(() => ({ value: [] }))).value.sort((x, y) => (y.sentDateTime ?? "").localeCompare(x.sentDateTime ?? ""));
      const hit = sent.find((m) => /^\s*((re|fw|fwd)\s*:\s*)*intro\b/i.test(m.subject ?? "") && partyA && partyB && (m.subject ?? "").toLowerCase().includes(partyA.toLowerCase()) && (m.subject ?? "").toLowerCase().includes(partyB.toLowerCase()));
      if (hit) {
        const draft = await createReplyAllDraft(me.email, hit.id).catch(() => null);
        if (draft) {
          const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
          const body = draft.body?.content ?? "";
          const block = `<div style="${F}"><p style="margin:0 0 12pt 0;${F}">${introGreeting}</p>${await signatureFor(me.email)}<br></div>`;
          await updateDraftBody(me.email, draft.id, body.search(/<body[^>]*>/i) >= 0 ? body.replace(/(<body[^>]*>)/i, `$1${block}`) : `${block}${body}`);
          const fresh = await getMessage(me.email, draft.id, "id,webLink,internetMessageId");
          return { ok: true as const, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(me.email, draft.id), messageId: fresh.internetMessageId ?? null, mode: "replyAll" as const, attachments: 0 };
        }
      }
      return { ok: false as const, reason: `Could not find the intro email between ${partyA || "the firm"} and ${partyB || "the sponsor"} in your mailbox. Open it in Outlook and reply there, or mark the record Deal Lost.` };
    }
    // 1) the email the deal was mentioned in (for a deal we only heard about, usually the intro or the sponsor's note)
    let sourceId: string | null = details.mentionedMessageId ?? null;
    if (!sourceId && details.mentionedIn && deal.sponsorCompanyId) {
      const norm = (t: string) => t.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();
      const acts = await prisma.activity.findMany({ where: { type: "EMAIL", externalId: { not: null }, OR: [{ companyId: deal.sponsorCompanyId }, { contact: { companyId: deal.sponsorCompanyId } }] }, orderBy: { occurredAt: "desc" }, take: 60, select: { subject: true, externalId: true } });
      sourceId = acts.find((a) => norm(a.subject ?? "") === norm(details.mentionedIn!))?.externalId ?? null;
    }
    if (sourceId) {
      const r = await createThreadReplyDraft(me.email, sourceId, greeting);
      if (r.ok) return r;
      const t = await replyViaTeammateCopy(me.email, sourceId);
      if (t?.ok) return t;
    }
    // 2) the ongoing sponsor-only conversation about this deal
    if (people.length) {
      const { sponsorThreadFor } = await import("@/lib/sponsor-thread");
      const thread = await sponsorThreadFor(me.email, { id: deal.id, name: deal.name, propertyName: deal.propertyName, city: deal.city, state: deal.state, sponsorCompanyId: deal.sponsorCompanyId, requestedAmount: deal.requestedAmount }, { emails: people.map((p) => p.email), domain: deal.sponsorCompany?.domain ?? null }).catch(() => null);
      if (thread) {
        const { createReplyAllDraft, getMessage, outlookDesktopLink, updateDraftBody } = await import("@/lib/graph");
        const draft = await createReplyAllDraft(me.email, thread.messageId).catch(() => null);
        if (draft) {
          const F = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
          const body = draft.body?.content ?? "";
          const block = `<div style="${F}"><p style="margin:0 0 12pt 0;${F}">${greeting}</p>${await signatureFor(me.email)}<br></div>`;
          await updateDraftBody(me.email, draft.id, body.search(/<body[^>]*>/i) >= 0 ? body.replace(/(<body[^>]*>)/i, `$1${block}`) : `${block}${body}`);
          const fresh = await getMessage(me.email, draft.id, "id,webLink,internetMessageId");
          return { ok: true as const, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(me.email, draft.id), messageId: fresh.internetMessageId ?? null, mode: "replyAll" as const, attachments: 0 };
        }
      }
    }
    // 3) the latest thread with the sponsor's usual person about the deal, else a fresh email
    const contact = people[0] ?? (deal.sponsorCompanyId ? await bestContactForCompany(deal.sponsorCompanyId) : null);
    if (!contact?.email) return { ok: false as const, reason: `No sponsor contact with an email on ${dealName}. Link the sponsor company on the ticket.` };
    const words = dealName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return await replyToLatestWith(me.email, contact.email, `RE: ${dealName}`, words);
  } catch (e) {
    return { ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

// ---------- progress reports due (Ready for launch) ----------
export async function openReportDraftAction(dealId: string) {
  const me = await currentUser();
  if (!me) return { ok: false as const, reason: "Sign in with Microsoft (bottom of the sidebar) so the draft is created in your own mailbox." };
  const { openReportDraft } = await import("@/lib/report-due");
  const r = await openReportDraft(dealId, me.email).catch((e) => ({ ok: false as const, reason: String(e instanceof Error ? e.message : e).slice(0, 200) }));
  revalidatePath("/");
  return r;
}
/** Sent by hand already: restart the clock without a draft. */
export async function markReportSentAction(dealId: string) {
  await prisma.deal.update({ where: { id: dealId }, data: { reportSentAt: new Date(), reportDraftId: null, reportDraftMailbox: null, reportDraftAt: null } });
  revalidatePath("/");
}
