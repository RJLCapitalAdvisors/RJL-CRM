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
export const HUMAN_DEPARTURE = /\b(?:I|I'm|he|she|they|[A-Z][a-z'’.-]+(?: [A-Z][a-z'’.-]+){0,2})\s+(?:am|is|are|has|have|was|'s)?\s*(?:no longer (?:employed|with|at|here|a part of|associated|working (?:at|with|for|here)|handl(?:es|ing))|(?:since )?left (?:the |our |my )?(?:company|firm|organization|team|bank|group|role|position)|departed\b|moved on(?: from| to)?|retired)|\bno longer (?:with|at|employed (?:by|with|at)) (?:the |our )?(?:company|firm|organization|team|bank|group)|\bleft the (?:company|firm|organization|team)\b/;
// "I left you a VM", "I left the meeting early", "I have left comments" are not departures: leaving must name the firm, role or team.
// "That time no longer works for Matt" is not one either (Oct 13, 2026: it almost removed Matt): the thing that is "no longer" has to be a person.

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
  const re = /(?:^|[^\w@.])(?!(?:Please|Thank|Thanks|He|She|They|This|That|The|Our|My|Your|Hi|Hello|Dear|Kindly|Note|Unfortunately)\b)([A-Z][\w'’.-]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][\w'’.-]+){0,2})\s+(?:is|has|was|have)\s+(?:no longer|since left|left|departed|moved on|retired)/g;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (/(?:contact|reach(?: out to)?|email|e-mail|forward(?:ed)? to|inquiries to|questions to)\s*$/i.test(before)) continue; // "please contact Greg Khodara ..." names the replacement
    return m[1].trim();
  }
  return null;
}

/** Addresses the notice points to ("please contact ... greg@artisancp.com", "direct inquiries to Matt.Beverly@transformco.com"): the replacement, never the departed. */
function replacementAddressesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:contact|reach out to|reach|direct(?:ed)? (?:any |all )?(?:inquiries|questions|requests|matters)[^.]{0,30}? to|email|e-mail|forward(?:ed)? to|send(?:ing)?[^.]{0,20}? to|work with)\s+[^.@\n]{0,60}?([\w.+-]+@[\w-]+\.[\w.-]+)/gi)) out.add(m[1].toLowerCase().replace(/[.,;:)>]+$/, ""));
  return [...out].filter((e) => !/rjlcapadvisors|rjlequities|postmaster|mailer-daemon|noreply|no-reply/i.test(e));
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
export async function addReplacementContacts(text: string, departedContactId: string | null, fallbackCompanyId: string | null = null): Promise<string[]> {
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
  // "direct inquiries to Matt.Beverly@transformco.com": an address with no name beside it; the name is read off the address (Joe Davidson's notice, Oct 13, 2026)
  for (const email of replacementAddressesIn(text)) {
    if (pairs.some((p) => p.email.toLowerCase().replace(/[.,;:)>]+$/, "") === email)) continue;
    const local = email.split("@")[0].replace(/\d+/g, "");
    const bits = local.split(/[._-]+/).filter(Boolean);
    const cap = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase();
    const name = bits.length >= 2 ? `${cap(bits[0])} ${bits.slice(1).map(cap).join(" ")}` : bits.length === 1 && bits[0].length > 2 ? cap(bits[0]) : email;
    pairs.push({ name, email, index: text.toLowerCase().indexOf(email), len: email.length });
  }
  for (const m of pairs) {
    const name = m.name.replace(/\s+(at|via|by)$/i, "").trim();
    const email = m.email.toLowerCase().replace(/[.,;:)>]+$/, "");
    if (/rjlcapadvisors|rjlequities|postmaster|mailer-daemon|noreply|no-reply/i.test(email)) continue;
    if (departed?.email && email === departed.email.toLowerCase()) continue;
    const parts = name.includes("@") ? [] : name.split(/\s+/).filter((x) => !/^(mr|mrs|ms|dr)\.?$/i.test(x));
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
    // the firm: the one on the address's domain when the CRM has it (a parent company's domain), else the departed person's, else the sender's
    const domain = email.split("@")[1];
    const companyId = (await (await import("@/lib/domains")).companyByDomain(domain))?.id ?? departed?.companyId ?? fallbackCompanyId;
    const phone = text.slice(m.index, m.index + m.len + 60).match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0] ?? null;
    await prisma.contact.create({ data: { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null, email, companyId, phone } }).catch(() => null);
    out.push(parts.length ? name : email);
  }
  return out;
}

/** One inbound email: if it says someone left, queue the removal for that person only. Returns proposals made. */
export async function noteDepartureIfAny(opts: { subject: string | null; text: string | null; fromAddress: string | null; contactId: string | null; messageId: string | null; when?: Date | null }): Promise<number> {
  if (!looksLikeDeparture(opts.subject, opts.text)) return 0;
  // a notice older than two weeks when it is read is history (the mailbox backfill filed sixty of them in Data updates, Oct 13, 2026)
  if (opts.when && Date.now() - opts.when.getTime() > 14 * 86_400_000) return 0;
  // only what the writer wrote: the quoted thread below ("> On Mar 31, Jonathan Livi wrote:") names the people we wrote to (Brock's note about Gary made Gary the replacement, Oct 13, 2026)
  const text = (opts.text ?? "").split(/\s*>?\s*(?:From:|-----Original Message-----|On .{5,140}? wrote:|Sent from my )/i)[0].replace(/\s+/g, " ");
  const ids = new Set<string>();
  const autoReply = !BOUNCE_SUBJECT.test(opts.subject ?? "") && DEPARTURE_SUBJECT.test(opts.subject ?? "");
  const senderDomain = opts.fromAddress?.split("@")[1]?.toLowerCase();

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
      // "Wendy Ruberti is no longer employed with ...": that person, found at the sender's firm first, then anywhere by full name,
      // then by last name at the firm. Never the one who wrote, unless the name is theirs (Jonathan, Oct 13, 2026: a colleague's
      // reply about someone else was removing the colleague)
      const parts = norm(name).split(" ");
      const first = parts[0], last = parts[parts.length - 1];
      const replacements = new Set(replacementAddressesIn(text));
      const notReplacement = (c: { email: string | null }) => !c.email || !replacements.has(c.email.toLowerCase());
      const cands = parts.length > 1 ? (await prisma.contact.findMany({ where: { firstName: { equals: first, mode: "insensitive" }, lastName: { contains: last, mode: "insensitive" }, departedAt: null }, select: { id: true, email: true } })).filter(notReplacement) : [];
      const atFirmLast = senderDomain && parts.length > 1 ? (await prisma.contact.findMany({ where: { email: { endsWith: `@${senderDomain}`, mode: "insensitive" }, lastName: { equals: last, mode: "insensitive" }, departedAt: null }, select: { id: true, email: true } })).filter(notReplacement) : [];
      const atFirmFirst = senderDomain ? (await prisma.contact.findMany({ where: { email: { endsWith: `@${senderDomain}`, mode: "insensitive" }, firstName: { equals: first, mode: "insensitive" }, departedAt: null }, select: { id: true, email: true } })).filter(notReplacement) : [];
      const pick = cands.find((c) => senderDomain && c.email?.toLowerCase().endsWith(`@${senderDomain}`)) ?? (cands.length === 1 ? cands[0] : null) ?? (atFirmLast.length === 1 ? atFirmLast[0] : null) ?? (atFirmFirst.length === 1 ? atFirmFirst[0] : null);
      if (pick) ids.add(pick.id);
      // the person named is not in the CRM: nothing to remove, but the replacement the notice points to still joins (Jonathan, Oct 13, 2026)
      else if (replacements.size && senderDomain) { const firm = await (await import("@/lib/domains")).companyByDomain(senderDomain); await addReplacementContacts(text, null, firm?.id ?? null).catch(() => []); }
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
        if (named.length === 1) ids.add(named[0].id); // "the one person we know at that firm" is no longer a guess: it picked the replacement (Greg Khodara, Oct 13, 2026)
      }
      // nobody resolvable: only an auto-reply from the person's own mailbox points at the sender ("The person you are trying to reach is no
      // longer with the firm"); a human colleague's note about an unnamed or unknown person proposes nothing rather than the colleague
      if (!ids.size && opts.contactId && autoReply && !/\b(?:he|she|they)\b[^.]{0,30}(?:no longer|has left|have left|moved on)/i.test(text) && /no longer|has left|is no longer|moved on|departed|trying to reach is no/i.test(text)) ids.add(opts.contactId);
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
