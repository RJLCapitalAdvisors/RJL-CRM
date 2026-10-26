import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { stripDashes } from "@/lib/style";
import { lineMatchesGroup, normName, ownListGroups, readGroupList, type StruckGroup } from "@/lib/engagement-reply";

/**
 * Sponsors answer in whatever mailbox the thread lives in, not only in deals@. Every inbound email from a
 * sponsor-side contact on an active deal is read once: its answers become Questions answered and fill blanks
 * on the ticket, and after an engagement letter went out, a "we are good with the agreement" (with any groups
 * to leave out) marks the letter signed and trims the groups, so the deal lands in Deals ready for launch.
 */

const q = (s: string) => encodeURIComponent(s);
const DAYS = 10;

const Confirmation = z.object({
  confirmsEngagement: z.boolean().describe("True only if the sponsor clearly agrees to the engagement letter / the proposed list of groups (e.g. 'we are good with the agreement', 'approved', 'let's go', 'confirmed')."),
  removeGroups: z.array(z.string()).describe("Investor groups the sponsor wants left out: they already have a relationship, they are talking to them directly, they asked to remove them, or they marked them in the list (an X, 'remove', 'no', 'skip' next to the name). Names as written."),
  addGroups: z.array(z.string()).describe("Groups the sponsor asked to add, if any."),
  keepOnly: z.array(z.string()).describe("When the sponsor writes out the groups RJL MAY approach (a revised, approved or permitted list, 'here is the list excluding the ones we already contacted', 'these are the groups we don't know and haven't received the package', 'you are OK to send to these'), those names exactly as written; every other proposed group is then off. When the reply points back to a list the sponsor sent earlier on the thread ('the 11 groups I mentioned below'), give that earlier list's names. Empty when the names they write are the ones to REMOVE, or when they write no list."),
  note: z.string().describe("One line of what else the sponsor said about the raise, or empty."),
});

async function fullBody(mailbox: string, internetMessageId: string): Promise<{ html: string; text: string; graphId: string; hasAttachments: boolean } | null> {
  try {
    const r = await graph<{ value: { id: string; hasAttachments?: boolean; body: { content: string } }[] }>(`/users/${q(mailbox)}/messages?$filter=${encodeURIComponent(`internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`)}&$select=id,hasAttachments,body`);
    const html = r.value[0]?.body?.content;
    if (!html) return null;
    const graphId = r.value[0].id, hasAttachments = Boolean(r.value[0].hasAttachments);
    const text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    return { html, text, graphId, hasAttachments };
  } catch {
    return null;
  }
}

/** The sponsor's words: what they wrote on top, plus the first quoted email when they answered inline ("see below in blue"). */
const ownWords = (text: string) => {
  const parts = text.split(/\bFrom:\s|\bOn [A-Z][a-z]{2},? [A-Z][a-z]{2,8}\.? \d{1,2},? \d{4},? (?:at )?\d{1,2}:\d{2}\s?[AP]?M?[^:]{0,120}wrote:/);
  const top = parts[0];
  const inline = /below|inline|in (?:blue|red|bold|caps)|my answers|answers? (?:are|below)|see (?:my )?(?:comments|responses|notes)/i.test(top) && parts[1];
  return (inline ? `${top}\n\n[Inline answers follow inside the quoted email; the sponsor's answers sit next to the questions.]\nFrom: ${parts[1]}` : top).slice(0, 12000);
};

/** Read new sponsor replies on active deals. Returns how many were processed and how many letters were confirmed. */
export async function processSponsorReplies(): Promise<{ read: number; confirmed: number; facts: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { read: 0, confirmed: 0, facts: 0 };
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const deals = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES] }, sponsorCompanyId: { not: null } }, select: { id: true, name: true, propertyName: true, stage: true, details: true, sponsorCompanyId: true } });
  let read = 0, confirmed = 0, facts = 0;
  const client = new Anthropic();
  for (const d of deals) {
    const acts = await prisma.activity.findMany({ where: { type: "EMAIL", direction: "INBOUND", occurredAt: { gte: since }, externalId: { not: null }, OR: [{ dealId: d.id, companyId: d.sponsorCompanyId }, { dealId: d.id, contact: { companyId: d.sponsorCompanyId } }] }, orderBy: { occurredAt: "asc" } });
    for (const a of acts) {
      if (await prisma.dealEmail.findUnique({ where: { messageId: a.externalId! } })) continue; // already read (deals@ intake, or an earlier pass)
      const meta = a.meta ? (JSON.parse(a.meta) as { mailbox?: string }) : {};
      const full = meta.mailbox ? await fullBody(meta.mailbox, a.externalId!) : null;
      const body = full?.text ?? a.body ?? "";
      const words = ownWords(body);
      await prisma.dealEmail.create({ data: { dealId: d.id, messageId: a.externalId!, subject: a.subject, fromEmail: null, receivedAt: a.occurredAt, kind: "SPONSOR_REPLY" } }).catch(() => null);
      // the files the sponsor sent (a roof map, comps, a Placer report) belong on the ticket, whichever mailbox they came to
      if (full?.hasAttachments && meta.mailbox) {
        const { recordDealFiles } = await import("@/lib/deal-knowledge");
        await recordDealFiles(d.id, meta.mailbox, full.graphId, null, a.occurredAt).catch(() => 0);
      }
      read++;
      const stamp = a.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      // answers and documents mentioned become ticket knowledge
      const { extractDealFacts, mergeIntoDeal } = await import("@/lib/deal-knowledge");
      if (words.length > 40) {
        facts += await extractDealFacts(d.id, words, `${a.subject ?? "sponsor email"} (${stamp})`, { mayEnterFaq: true }).catch(() => 0);
        // the full Opus re-read only for a long write-up; a few lines are read by the facts pass and the open-asks pass, which fill the same blanks
        // (Oct 14, 2026: 108 of 123 sponsor replies in a month were under 1,500 characters and each ran four Claude reads)
        if (words.length > 6000) await mergeIntoDeal(d.id, words, a.subject ?? "").catch(() => 0);
        await (await import("@/lib/deal-knowledge")).fillMissingFromText(d.id, words, a.subject ?? "the sponsor's email").catch(() => null); // the open asks, answered from the words (Oct 8, 2026)
        if (words.length > 1500) await (await import("@/lib/enrich-narratives")).improveNarratives(d.id, words, `${a.subject ?? "the sponsor's email"} (${stamp})`).catch(() => null);
      }
      // engagement letter confirmation
      const det = JSON.parse(d.details || "{}") as Record<string, unknown>;
      const letterOut = Boolean(det.engagementSentAt || det.engagementDraftedAt);
      const alreadySigned = ["Engagement Letter Signed", "Deal Taken To Market", "Intro To Capital Made", "Term Sheet Issued", "Term Sheet Signed"].includes(d.stage);
      // the list the sponsor sent back, compared with the deal's groups: erased names and crossed-out lines are struck
      const { engagementGroups, finalizeEngagement } = await import("@/lib/send-deal");
      const current = await engagementGroups(d.id);
      // a list the sponsor typed out themselves (three names or more) is read by Claude as a kept list or a remove list; the quoted
      // letter under it is then left alone, since it is only the letter as we sent it (Citivest, Oct 15, 2026)
      const ownList = full?.html ? ownListGroups(current, full.html) : [];
      // a sponsor who writes out three or more of the ticket's groups is read whatever the stage and whether or not the CRM sent the letter:
      // Jonathan proposed the Hedges Greene pref list by hand on a signed ticket and Kyle's revised list was skipped (Oct 24, 2026)
      if (ownList.length < 3 && (!letterOut || alreadySigned)) continue;
      const list = full?.html && ownList.length < 3 ? readGroupList(current, full.html) : { listSeen: false, erased: [], crossed: [], kept: current, listText: "" };
      const spoke = /agree|good with|approved|confirm|let'?s go|let'?s get|works for|fine with|proceed|go ahead|relationship|remove|removed|take out|leave out|exclud|struck|crossed|redline|contacted|reached out|revised|updated list|permitted|(?:haven'?t|not|never) received|haven'?t (?:seen|had|got)|don'?t know|ok(?:ay)? to (?:send|go)|carved? out|only (?:send|go|approach)/i.test(words);
      if (!spoke && !list.listSeen && ownList.length < 3) continue;
      // the list may sit in the sponsor's earlier email on the thread, with this one only confirming it (Zamir Kazi, Oct 26, 2026: the 11 groups
      // came at 12:36, "confirmed, you are OK to send to the 11 groups i mentioned below" at 2:45, and the second was read without the first)
      const priorList = ownList.length < 3 ? await earlierSponsorList(d.id, a.occurredAt, d.sponsorCompanyId, current, det) : null;
      const groups = ((det.engagementGroups as string[] | undefined) ?? []);
      let parsed: z.infer<typeof Confirmation> | null = null;
      // a failed read was tried once more (Oct 15, 2026: the first read of Kyle's list came back empty)
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) try {
        const res = await client.messages.parse({
          model: "claude-sonnet-5",
          max_tokens: 500,
          system: [
            "RJL Capital Advisors sent a sponsor an engagement letter listing the investor groups RJL proposes to take their deal to. Read the sponsor's reply and decide whether they confirmed the engagement, and which groups they want removed or added.",
            "Be literal; a sponsor saying they 'have relationships with' or 'know' or 'are already talking to' certain groups means those groups come off the list. A sponsor who sends the list back edited (names erased or crossed out) and says to proceed, 'let's get it going', 'otherwise fine', 'the rest works' has confirmed. A question about fees or the tail period alongside that is still a confirmation.",
            "When the quoted list is given, a mark next to a name (an X, 'remove', 'no', 'skip', 'already spoke to them') means that group comes off; list it in removeGroups by its name as written.",
          ].join(" "),
          messages: [{ role: "user", content: `DEAL: ${d.propertyName ?? d.name}\nPROPOSED GROUPS: ${groups.join(" | ") || current.map((g) => g.name).join(" | ") || "(unknown)"}\n\nSPONSOR REPLY (${stamp}):\n${words}${list.listSeen ? `\n\nTHE LIST AS THE SPONSOR SENT IT BACK (names missing from it were erased by the sponsor: ${list.erased.map((g) => g.name).join(", ") || "none"}; crossed out: ${list.crossed.map((g) => g.name).join(", ") || "none"}):\n${list.listText}` : ""}${priorList ? `\n\nTHE SPONSOR'S EARLIER EMAIL ON THIS THREAD (${priorList.stamp}), which named these groups: ${priorList.groups.map((g) => g.name).join(", ")}:\n${priorList.words}` : ""}` }],
          output_config: { format: zodOutputFormat(Confirmation) },
        });
        parsed = res.parsed_output;
      } catch (e) {
        console.error("engagement reply read failed", d.id, String(e).slice(0, 300));
        parsed = null;
      }
      const asked = current.filter((g) => !list.erased.includes(g) && !list.crossed.includes(g)).filter((g) => (parsed?.removeGroups ?? []).some((r) => normName(g.name).includes(normName(r)) || (normName(r).includes(normName(g.name).split(" ")[0]) && normName(g.name).split(" ")[0].length > 3)));
      const at = a.occurredAt.toISOString();
      const by = await prisma.contact.findFirst({ where: { id: a.contactId ?? "" }, select: { firstName: true, lastName: true } }).then((c) => (c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || null : null));
      const struck: StruckGroup[] = [];
      for (const g of list.erased) struck.push({ name: g.name, companyId: g.companyId || null, how: "erased", at, by });
      for (const g of list.crossed) if (!struck.some((s) => s.name === g.name)) struck.push({ name: g.name, companyId: g.companyId || null, how: "crossed out", at, by });
      for (const g of asked) if (!struck.some((s) => s.name === g.name)) struck.push({ name: g.name, companyId: g.companyId || null, how: "asked", at, by });
      // the sponsor wrote out the groups we may approach: every letter group not on it is left out (at least two must match, so a stray name never empties the list)
      const keepOnly = parsed?.keepOnly ?? [];
      let keptGroups = current.filter((g) => keepOnly.some((k) => lineMatchesGroup(k, g)));
      // a confirmation that points back at the earlier list ("the 11 groups i mentioned below") keeps that list even when the read came back without names
      if (keptGroups.length < 2 && priorList && priorList.kind === "keep" && /\b(?:below|above|mentioned|listed|those|these|\d+ groups|carved)\b/i.test(words)) keptGroups = priorList.groups;
      // a revised list that names a section of RJL's proposal ("Revised list for Tier 2") only speaks for that section: the other tiers stay
      const scope = keptGroups.length >= 2 ? await listScope(d.id, a.occurredAt, meta.mailbox ?? null, words, current) : current;
      const leftOut = keptGroups.length >= 2 ? scope.filter((g) => !keptGroups.includes(g)) : [];
      for (const g of leftOut) if (!struck.some((s) => s.name === g.name)) struck.push({ name: g.name, companyId: g.companyId || null, how: "left out", at, by });
      if (!struck.length && !parsed?.confirmsEngagement) continue;
      // the struck groups are unticked on the ticket's engagement card, whether or not the letter is confirmed yet
      const earlier = ((det.engagementStruck as StruckGroup[] | undefined) ?? []).filter((s) => !struck.some((n) => n.name === s.name));
      const fresh = await prisma.deal.findUnique({ where: { id: d.id }, select: { details: true } });
      const detNow = JSON.parse(fresh?.details || "{}") as Record<string, unknown>;
      await prisma.deal.update({ where: { id: d.id }, data: { details: JSON.stringify({ ...detNow, engagementStruck: [...earlier, ...struck], ...(parsed?.confirmsEngagement ? { engagementConfirmedAt: at, engagementConfirmedBy: by } : {}) }) } });
      const { logActivity } = await import("@/lib/activity");
      const what = [list.erased.length ? `erased from the list: ${list.erased.map((g) => g.name).join(", ")}` : "", list.crossed.length ? `crossed out: ${list.crossed.map((g) => g.name).join(", ")}` : "", asked.length ? `asked to remove: ${asked.map((g) => g.name).join(", ")}` : "", leftOut.length ? `left off the list they sent back: ${leftOut.map((g) => g.name).join(", ")}` : "", parsed?.addGroups.length ? `asked to add: ${parsed.addGroups.join(", ")}` : ""].filter(Boolean).join("; ");
      const keep = current.filter((g) => g.companyId && !struck.some((s) => s.companyId === g.companyId)).map((g) => g.companyId);
      if (alreadySigned || !letterOut) {
        // a list on a signed ticket (going wider for pref) or on a thread with no CRM letter: the agreed groups change, the stage does not
        if (struck.length) await finalizeEngagement(d.id, keep, [], { markSigned: false });
        await logActivity({ type: "NOTE", body: stripDashes(`${by ?? "The sponsor"} sent the group list back (${stamp}); ${what || "no changes"}.${parsed?.note ? ` ${parsed.note}` : ""}`), dealId: d.id, companyId: d.sponsorCompanyId, occurredAt: a.occurredAt });
        continue;
      }
      if (!parsed?.confirmsEngagement) {
        await logActivity({ type: "NOTE", body: stripDashes(`${by ?? "The sponsor"} sent the group list back (${stamp}); ${what}. Unticked on the ticket; the letter is not confirmed yet.`), dealId: d.id, companyId: d.sponsorCompanyId, occurredAt: a.occurredAt });
        continue;
      }
      await finalizeEngagement(d.id, keep, []);
      await logActivity({ type: "NOTE", body: stripDashes(`${by ?? "The sponsor"} confirmed the engagement by email (${stamp})${what ? `; ${what}` : ""}${parsed.note ? `. ${parsed.note}` : ""}`), dealId: d.id, companyId: d.sponsorCompanyId, occurredAt: a.occurredAt });
      confirmed++;
    }
  }
  return { read, confirmed, facts };
}

/**
 * The groups a sponsor's revised list speaks for: when RJL's own email that proposed the list had sections ("Tier 1 - Already
 * approached", "Tier 2 - New groups for pref") and the reply names one of them, only that section's groups; otherwise the whole ticket.
 * RJL's proposal is the latest outbound email on the ticket before the reply that names three or more of the groups.
 */
async function listScope(dealId: string, before: Date, mailbox: string | null, ownWords: string, current: Awaited<ReturnType<typeof import("@/lib/send-deal").engagementGroups>>) {
  const { listSections, sectionsNamed } = await import("@/lib/engagement-reply");
  const outs = await prisma.activity.findMany({ where: { dealId, type: "EMAIL", direction: "OUTBOUND", occurredAt: { lt: before }, externalId: { not: null } }, orderBy: { occurredAt: "desc" }, take: 6, select: { externalId: true, meta: true } });
  for (const o of outs) {
    const box = (o.meta ? (JSON.parse(o.meta) as { mailbox?: string }).mailbox : null) ?? mailbox;
    if (!box) continue;
    const full = await fullBody(box, o.externalId!);
    if (!full) continue;
    const text = full.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<\/(p|div|li|tr)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").split(/\nFrom: |\n_{10,}/)[0];
    const sections = listSections(text, current);
    if (sections.reduce((n, s) => n + s.groups.length, 0) < 3) continue;
    const named = sectionsNamed(ownWords, sections);
    return named.length ? [...new Set(named.flatMap((s) => s.groups))] : current;
  }
  return current;
}

/**
 * The sponsor's latest earlier email on the deal, since the letter went out, that wrote out three or more of the ticket's groups, with
 * a plain guess at whether it was a list to keep ("we don't know", "haven't received", "OK to send") or to drop ("we know", "already sent").
 */
async function earlierSponsorList(dealId: string, before: Date, sponsorCompanyId: string | null, current: Awaited<ReturnType<typeof import("@/lib/send-deal").engagementGroups>>, det: Record<string, unknown>) {
  const since = det.engagementSentAt ? new Date(String(det.engagementSentAt)) : new Date(before.getTime() - 14 * 86_400_000);
  const prior = await prisma.activity.findMany({ where: { dealId, type: "EMAIL", direction: "INBOUND", externalId: { not: null }, occurredAt: { gte: since, lt: before }, ...(sponsorCompanyId ? { OR: [{ companyId: sponsorCompanyId }, { contact: { companyId: sponsorCompanyId } }] } : {}) }, orderBy: { occurredAt: "desc" }, take: 5, select: { externalId: true, meta: true, occurredAt: true } });
  for (const p of prior) {
    const box = p.meta ? (JSON.parse(p.meta) as { mailbox?: string }).mailbox : null;
    if (!box) continue;
    const full = await fullBody(box, p.externalId!);
    if (!full) continue;
    const groups = ownListGroups(current, full.html);
    if (groups.length < 3) continue;
    const words = ownWords(full.text).slice(0, 4000);
    const kind = /don'?t know|haven'?t (?:seen|had|got|received)|not (?:seen|received)|ok(?:ay)? to (?:send|go)|may (?:send|go|approach)|can (?:send|go|approach)|permitted|approved|revised list|excluding/i.test(words) ? "keep" : "other";
    return { groups, words, kind, stamp: p.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  }
  return null;
}
