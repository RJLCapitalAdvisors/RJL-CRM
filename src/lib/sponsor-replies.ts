import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { stripDashes } from "@/lib/style";

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
  removeGroups: z.array(z.string()).describe("Investor groups the sponsor wants left out (they already have a relationship, they are talking to them directly, they asked to remove them). Names as written."),
  addGroups: z.array(z.string()).describe("Groups the sponsor asked to add, if any."),
  note: z.string().describe("One line of what else the sponsor said about the raise, or empty."),
});

async function fullBody(mailbox: string, internetMessageId: string): Promise<string | null> {
  try {
    const r = await graph<{ value: { body: { content: string } }[] }>(`/users/${q(mailbox)}/messages?$filter=${encodeURIComponent(`internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`)}&$select=body`);
    const html = r.value[0]?.body?.content;
    if (!html) return null;
    // the sponsor's own words: everything above the first quoted header
    const text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    return text;
  } catch {
    return null;
  }
}

/** The sponsor's words: what they wrote on top, plus the first quoted email when they answered inline ("see below in blue"). */
const ownWords = (text: string) => {
  const parts = text.split(/\bFrom:\s/);
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
      const body = (meta.mailbox ? await fullBody(meta.mailbox, a.externalId!) : null) ?? a.body ?? "";
      const words = ownWords(body);
      await prisma.dealEmail.create({ data: { dealId: d.id, messageId: a.externalId!, subject: a.subject, fromEmail: null, receivedAt: a.occurredAt, kind: "SPONSOR_REPLY" } }).catch(() => null);
      read++;
      const stamp = a.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      // answers and documents mentioned become ticket knowledge
      const { extractDealFacts, mergeIntoDeal } = await import("@/lib/deal-knowledge");
      if (words.length > 40) {
        facts += await extractDealFacts(d.id, words, `${a.subject ?? "sponsor email"} (${stamp})`, { mayEnterFaq: true }).catch(() => 0);
        await mergeIntoDeal(d.id, words, a.subject ?? "").catch(() => 0);
      }
      // engagement letter confirmation
      const det = JSON.parse(d.details || "{}") as Record<string, unknown>;
      const letterOut = Boolean(det.engagementSentAt || det.engagementDraftedAt);
      const alreadySigned = ["Engagement Letter Signed", "Deal Taken To Market", "Intro To Capital Made", "Term Sheet Issued", "Term Sheet Signed"].includes(d.stage);
      if (!letterOut || alreadySigned || !/agree|good with|approved|confirm|let'?s go|works for|fine with|proceed|go ahead|relationship|remove|take out|leave out|exclude/i.test(words)) continue;
      const groups = ((det.engagementGroups as string[] | undefined) ?? []);
      let parsed: z.infer<typeof Confirmation> | null = null;
      try {
        const res = await client.messages.parse({
          model: "claude-sonnet-5",
          max_tokens: 400,
          system: "RJL Capital Advisors sent a sponsor an engagement letter listing the investor groups RJL proposes to take their deal to. Read the sponsor's reply and decide whether they confirmed the engagement, and which groups they want removed or added. Be literal; a sponsor saying they 'have relationships with' or 'know' or 'are already talking to' certain groups means those groups come off the list.",
          messages: [{ role: "user", content: `DEAL: ${d.propertyName ?? d.name}\nPROPOSED GROUPS: ${groups.join(" | ") || "(unknown)"}\n\nSPONSOR REPLY (${stamp}):\n${words}` }],
          output_config: { format: zodOutputFormat(Confirmation) },
        });
        parsed = res.parsed_output;
      } catch {
        parsed = null;
      }
      if (!parsed?.confirmsEngagement) continue;
      const { engagementGroups, finalizeEngagement } = await import("@/lib/send-deal");
      const current = await engagementGroups(d.id);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const removed = current.filter((g) => parsed!.removeGroups.some((r) => norm(g.name).includes(norm(r)) || norm(r).includes(norm(g.name).split(" ")[0]) && norm(g.name).split(" ")[0].length > 3));
      const keep = current.filter((g) => g.companyId && !removed.some((r) => r.companyId === g.companyId)).map((g) => g.companyId);
      await finalizeEngagement(d.id, keep, []);
      const { logActivity } = await import("@/lib/activity");
      await logActivity({ type: "NOTE", body: stripDashes(`Sponsor confirmed the engagement by email (${stamp})${removed.length ? `; removed at their request: ${removed.map((g) => g.name).join(", ")}` : ""}${parsed.addGroups.length ? `; asked to add: ${parsed.addGroups.join(", ")}` : ""}${parsed.note ? `. ${parsed.note}` : ""}`), dealId: d.id, companyId: d.sponsorCompanyId, occurredAt: a.occurredAt });
      confirmed++;
    }
  }
  return { read, confirmed, facts };
}
