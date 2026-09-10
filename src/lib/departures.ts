import { prisma } from "@/lib/db";

/**
 * People leave. Their firm's auto-reply ("Chris Westcott is no longer employed by Parse Capital") or the
 * bounce ("Undeliverable ... user unknown") is the only notice we get. Those become a "Remove this contact"
 * item in Data updates for Jonathan to approve; approving marks the contact departed (never emailed again,
 * hidden from pickers). Nothing is removed without his click. The colleague the auto-reply points to
 * ("please contact Anthony Strauser") is a replacement, never a removal.
 */

export const DEPARTURE_SUBJECT = /^(?:(?:re|fw|fwd)\s*:\s*)?(?:automatic reply|auto-?reply|autoreply|out of (?:the )?office|undeliverable|undelivered|delivery (?:status notification|has failed|failure|notification)|mail delivery (?:failed|failure|subsystem)|returned mail|failure notice|non-?deliverable)/i;
const BOUNCE_SUBJECT = /undeliverable|undelivered|delivery|returned mail|failure notice|non-?deliverable|wasn't delivered|not delivered/i;
export const DEPARTURE_BODY = /no longer (?:employed|with|works?|at|a part of|associated)|has (?:since )?left (?:the |our )?(?:company|firm|organization|team|bank)|is no longer (?:with|at|employed)|left the (?:company|firm|organization)|(?:has|have) (?:departed|moved on)|not a valid recipient|recipient (?:address )?(?:rejected|not found|unknown)|does not exist|user unknown|unknown user|mailbox (?:unavailable|not found|does not exist)|address(?:es)? (?:rejected|not found)|address (?:couldn't|could not) be found|550 5\.1\.1|no such user|account (?:has been )?(?:disabled|deactivated)/i;

/** A departure notice: an auto-reply or bounce whose body says so, or any reply whose body says someone left (blast replies). */
export function looksLikeDeparture(subject: string | null | undefined, text: string | null | undefined): boolean {
  const body = text ?? "";
  if (DEPARTURE_SUBJECT.test((subject ?? "").trim())) return DEPARTURE_BODY.test(body);
  return HUMAN_DEPARTURE.test(body);
}
/** What a colleague writes back: "no longer with the firm", "has left", "moved on", "retired", "is no longer here". */
export const HUMAN_DEPARTURE = /no longer (?:employed|with|works?|at|a part of|associated|here|handles?)|has (?:since )?left (?:the |our )?(?:company|firm|organization|team|bank|group)|is no longer (?:with|at|employed|here)|left the (?:company|firm|organization|team)|(?:has|have) (?:departed|moved on|retired)|\bI(?:'m| am) no longer (?:with|at)|\bI (?:have )?(?:left|moved on)/i;

/** Queue "remove this contact" for approval (once per contact while pending). */
export async function proposeContactRemoval(contactId: string, evidence: string, sourceRef?: string | null, replacements: string[] = []): Promise<boolean> {
  const c = await prisma.contact.findUnique({ where: { id: contactId }, include: { company: { select: { id: true, name: true } } } });
  if (!c || c.departedAt) return false;
  const pending = await prisma.criteriaProposal.findFirst({ where: { contactId, status: "PENDING", changes: { contains: "removeContact" } } });
  if (pending) return false;
  const who = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "this contact";
  const firm = c.company?.name ?? "their firm";
  await prisma.criteriaProposal.create({
    data: {
      source: "EMAIL",
      sourceRef: sourceRef ?? null,
      companyId: c.company?.id ?? null,
      contactId,
      summary: `${who} appears to have left ${firm}${replacements.length ? `. New contact there: ${replacements.join(", ")} (added under ${firm})` : ""}`,
      changes: JSON.stringify([{ field: "removeContact", from: `${who} at ${firm}`, to: `Marked as departed: no more emails, off the pickers${replacements.length ? `. ${replacements.join(", ")} added at ${firm}` : ""}`, evidence: evidence.replace(/\s+/g, " ").trim().slice(0, 240) }]),
    },
  });
  return true;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/** The person an auto-reply says has left: "Chris Westcott is no longer employed by ...", "Rob Lochner has left ...". */
function departedNameIn(text: string): string | null {
  const m = text.match(/([A-Z][\w'’.-]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][\w'’.-]+){1,2})\s+(?:is|has|was)\s+(?:no longer|since left|left|departed|moved on)/);
  return m ? m[1].trim() : null;
}

/** The address a bounce is about: "wasn't delivered to han@...", "Recipient address rejected: x@y". */
function bouncedAddressIn(text: string): string | null {
  const m = text.match(/(?:delivered to|recipient(?: address)?|address|user|mailbox)\s*:?\s*<?([\w.+-]+@[\w-]+\.[\w.-]+)/i) ?? text.match(/<?([\w.+-]+@[\w-]+\.[\w.-]+)>?\s*(?:\(|:)?\s*(?:user unknown|does not exist|not found|rejected|couldn't be found|could not be found)/i);
  return m ? m[1].toLowerCase().replace(/[.,;:]+$/, "") : null;
}

/**
 * "Please contact Mike McFadden mmcfadden@brixtoncapital.com": the person the notice points to joins the CRM
 * under the departed person's company, so the next deal reaches them. Returns the names added or found.
 */
export async function addReplacementContacts(text: string, departedContactId: string | null): Promise<string[]> {
  const departed = departedContactId ? await prisma.contact.findUnique({ where: { id: departedContactId }, select: { companyId: true, email: true } }) : null;
  const out: string[] = [];
  // "contact Mike McFadden mmcfadden@...", "reach out to Jason Braidwood at jbraidwood@...", "please email Casey Layton at clayton@..."
  const re = /(?:contact|reach out to|reach|direct(?:ed)? (?:any |all )?(?:inquiries|questions|requests)[^.]{0,30}? to|email|e-mail|forward(?:ed)? to)\s+([A-Z][\w'’.-]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][\w'’.-]+){1,2})[^@\n]{0,40}?(?:<|\(|at\s+|:\s*)?([\w.+-]+@[\w-]+\.[\w.-]+)/g;
  const pairs: { name: string; email: string; index: number; len: number }[] = [];
  for (const m of text.matchAll(re)) pairs.push({ name: m[1], email: m[2], index: m.index ?? 0, len: m[0].length });
  // any "Name <email>" or "Name (email)" at the departed person's firm, however the sentence is phrased
  const departedDomain = departed?.email?.split("@")[1]?.toLowerCase();
  for (const m of text.matchAll(/([A-Z][\w'’.-]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][\w'’.-]+){1,2})\s*[<(:,]?\s*([\w.+-]+@[\w-]+\.[\w.-]+)/g)) {
    const email = m[2].toLowerCase().replace(/[.,;:)>]+$/, "");
    if (departedDomain && email.endsWith(`@${departedDomain}`) && !pairs.some((x) => x.email.toLowerCase().replace(/[.,;:)>]+$/, "") === email)) pairs.push({ name: m[1], email: m[2], index: m.index ?? 0, len: m[0].length });
  }
  for (const m of pairs) {
    const name = m.name.replace(/\s+(at|via|by)$/i, "").trim();
    const email = m.email.toLowerCase().replace(/[.,;:)>]+$/, "");
    if (/rjlcapadvisors|rjlequities|postmaster|mailer-daemon|noreply|no-reply/i.test(email)) continue;
    if (departed?.email && email === departed.email.toLowerCase()) continue;
    const parts = name.split(/\s+/).filter((x) => !/^(mr|mrs|ms|dr)\.?$/i.test(x));
    const existing = await prisma.contact.findUnique({ where: { email } });
    if (existing) {
      // known already: make sure they sit under the firm and have a name
      const data: { companyId?: string; firstName?: string; lastName?: string } = {};
      if (!existing.companyId && departed?.companyId) data.companyId = departed.companyId;
      if (!existing.firstName && parts.length) { data.firstName = parts[0]; data.lastName = parts.slice(1).join(" ") || undefined; }
      if (Object.keys(data).length) await prisma.contact.update({ where: { id: existing.id }, data }).catch(() => null);
      out.push(`${[existing.firstName ?? parts[0], existing.lastName ?? parts.slice(1).join(" ")].filter(Boolean).join(" ")} (already in the CRM)`);
      continue;
    }
    // the firm: the departed person's, else any company on the email's domain
    const domain = email.split("@")[1];
    const companyId = departed?.companyId ?? (await prisma.company.findFirst({ where: { domain }, select: { id: true } }))?.id ?? null;
    const phone = text.slice(m.index, m.index + m.len + 60).match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0] ?? null;
    await prisma.contact.create({ data: { firstName: parts[0], lastName: parts.slice(1).join(" ") || null, email, companyId, phone } }).catch(() => null);
    out.push(name);
  }
  return out;
}

/** One inbound email: if it says someone left, queue the removal for that person only. Returns proposals made. */
export async function noteDepartureIfAny(opts: { subject: string | null; text: string | null; fromAddress: string | null; contactId: string | null; messageId: string | null }): Promise<number> {
  if (!looksLikeDeparture(opts.subject, opts.text)) return 0;
  const text = (opts.text ?? "").replace(/\s+/g, " ");
  const ids = new Set<string>();

  if (BOUNCE_SUBJECT.test(opts.subject ?? "")) {
    // a bounce: the address that failed
    const addr = bouncedAddressIn(text) ?? (text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).find((e) => !/rjlcapadvisors|rjlequities|postmaster|mailer-daemon|noreply|no-reply/i.test(e)) ?? null;
    if (addr) {
      const c = await prisma.contact.findUnique({ where: { email: addr }, select: { id: true } });
      if (c) ids.add(c.id);
    }
  } else {
    // an auto-reply: the named person, else the sender when the notice is about them
    const name = departedNameIn(text);
    if (name) {
      const parts = norm(name).split(" ");
      const first = parts[0], last = parts[parts.length - 1];
      const sender = opts.fromAddress?.split("@")[1]?.toLowerCase();
      const cands = await prisma.contact.findMany({ where: { firstName: { equals: first, mode: "insensitive" }, lastName: { contains: last, mode: "insensitive" } }, select: { id: true, email: true } });
      const pick = cands.find((c) => sender && c.email?.toLowerCase().endsWith(`@${sender}`)) ?? (cands.length === 1 ? cands[0] : null) ?? (opts.contactId && cands.some((c) => c.id === opts.contactId) ? { id: opts.contactId } : null);
      if (pick) ids.add(pick.id);
    } else if (opts.contactId && /\bI(?:'m| am) no longer|\bI (?:have )?(?:left|moved on)/i.test(text)) {
      // the sender says it about themselves ("I am no longer with X")
      ids.add(opts.contactId);
    } else {
      // "John no longer works here": a colleague replying about someone at their firm we wrote to recently
      const sender = opts.fromAddress?.split("@")[1]?.toLowerCase();
      if (sender) {
        const since = new Date(Date.now() - 60 * 86_400_000);
        const cands = await prisma.contact.findMany({ where: { email: { endsWith: `@${sender}`, mode: "insensitive" }, departedAt: null, activities: { some: { direction: "OUTBOUND", occurredAt: { gte: since } } } }, select: { id: true, firstName: true, lastName: true, email: true } });
        const named = cands.filter((c) => {
          const first = (c.firstName ?? "").trim();
          const last = (c.lastName ?? "").trim();
          const near = (n: string) => n.length > 1 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.]{0,80}?(?:no longer|has left|left the|moved on|retired|departed)`, "i").test(text);
          return c.email?.toLowerCase() !== opts.fromAddress?.toLowerCase() && (near(first) || near(last) || (c.email && text.toLowerCase().includes(c.email.toLowerCase())));
        });
        if (named.length === 1) ids.add(named[0].id);
        else if (!named.length && cands.length === 1 && cands[0].email?.toLowerCase() !== opts.fromAddress?.toLowerCase()) ids.add(cands[0].id); // one person at that firm on our side of the thread
      }
      if (!ids.size && opts.contactId && /no longer|has left|is no longer|moved on|departed|trying to reach is no/i.test(text)) ids.add(opts.contactId);
    }
  }
  let n = 0;
  for (const id of ids) {
    const added = BOUNCE_SUBJECT.test(opts.subject ?? "") ? [] : await addReplacementContacts(text, id).catch(() => [] as string[]);
    if (await proposeContactRemoval(id, text, opts.messageId, added)) n++;
  }
  return n;
}

/** Catch up on the last N days of logged mail. */
export async function scanForDepartures(days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const acts = await prisma.activity.findMany({ where: { type: "EMAIL", direction: "INBOUND", occurredAt: { gte: since } }, select: { subject: true, body: true, contactId: true, externalId: true, meta: true } });
  let n = 0;
  for (const a of acts) {
    if (!DEPARTURE_SUBJECT.test((a.subject ?? "").trim())) continue;
    const from = a.meta ? ((JSON.parse(a.meta) as { from?: { address?: string } }).from?.address ?? null) : null;
    n += await noteDepartureIfAny({ subject: a.subject, text: a.body, fromAddress: from, contactId: a.contactId, messageId: a.externalId });
  }
  return n;
}
