import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { ACTIVE_STAGES } from "@/lib/taxonomy";

/**
 * When an LP replies to a deal asking for something (a 5-year model, the sponsor's markets, a rent roll),
 * that request is the sponsor's to answer. We read inbound LP emails on active deals, pull out the asks,
 * put them at the top of Deal momentum as an LP_ASK item whose Handle drafts the request email to the
 * sponsor, note them on the progress report, and move the LP to "Taking A Look" if they were still quiet.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 14;
const q = (s: string) => encodeURIComponent(s);

const Out = z.object({
  asks: z.array(z.string()).describe("Each thing the investor asked for from the sponsor or RJL, as a short imperative line, e.g. '5-year model', 'Which markets BrightStar operates in'. Empty if the email asks for nothing."),
  stance: z.enum(["reviewing", "interested", "pass", "unclear"]).describe("Where the investor stands after this email."),
  note: z.string().describe("One line for the progress report, dated by the caller, e.g. 'Reviewing; asked for 5-year model and sponsor markets'."),
});

export type LpAsk = { dealId: string; lpCompanyId: string; lpName: string; asks: string[]; answered: { ask: string; answer: string }[]; note: string; stance: string; messageId: string; contactId: string | null; at: Date };

export async function detectLpAsks(): Promise<LpAsk[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  const inbound = await prisma.activity.findMany({
    where: { type: "EMAIL", direction: "INBOUND", occurredAt: { gte: since }, externalId: { not: null }, contactId: { not: null }, companyId: { not: null } },
    include: { contact: { select: { id: true, companyId: true, firstName: true, lastName: true } }, company: { select: { id: true, name: true } } },
    orderBy: { occurredAt: "desc" },
  });
  const out: LpAsk[] = [];
  const client = new Anthropic();
  for (const a of inbound) {
    if (await prisma.lpAskScan.findUnique({ where: { externalId: a.externalId! } })) continue;
    // which deal: the one on the email, else the single active deal this firm is on the report of
    let dealId = a.dealId;
    if (!dealId) {
      // which of the deals this firm was sent is the email about: subject words, else the one we emailed them about most recently
      const rows = await prisma.dealInvestor.findMany({ where: { contact: { companyId: a.companyId! }, deal: { stage: { in: [...ACTIVE_STAGES] } }, status: { gte: 2 } }, include: { deal: { select: { id: true, propertyName: true, name: true, city: true } } }, orderBy: { updatedAt: "desc" } });
      if (rows.length === 1) dealId = rows[0].dealId;
      else if (rows.length > 1) {
        const subj = (a.subject ?? "").toLowerCase();
        const bySubject = rows.find((r) => [r.deal.propertyName ?? r.deal.name, r.deal.city ?? ""].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["retail", "portfolio", "recap", "deal", "opportunity", "capital", "intros"].includes(w)).some((w) => subj.includes(w)));
        if (bySubject) dealId = bySubject.dealId;
        else {
          const lastOut = await prisma.activity.findFirst({ where: { companyId: a.companyId!, type: "EMAIL", direction: "OUTBOUND", dealId: { in: rows.map((r) => r.dealId) } }, orderBy: { occurredAt: "desc" }, select: { dealId: true } });
          dealId = lastOut?.dealId ?? rows[0].dealId;
        }
      }
    }
    if (!dealId) {
      await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: "no-deal" } }).catch(() => {});
      continue;
    }
    const onReport = await prisma.dealInvestor.findFirst({ where: { dealId, contact: { companyId: a.companyId! } } });
    if (!onReport) {
      await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: "not-lp" } }).catch(() => {});
      continue;
    }
    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { propertyName: true, name: true, sponsorName: true } });
    // full body from the mailbox that has it
    let body = a.body ?? "";
    const meta = a.meta ? (JSON.parse(a.meta) as { mailbox?: string }) : {};
    if (meta.mailbox) {
      try {
        const r = await graph<{ value: { body: { content: string } }[] }>(`/users/${q(meta.mailbox)}/messages?$filter=internetMessageId eq '${a.externalId!.replace(/'/g, "''")}'&$select=body`);
        const html = r.value[0]?.body?.content;
        if (html) body = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
      } catch {
        /* preview only */
      }
    }
    let parsed: z.infer<typeof Out> | null = null;
    try {
      const res = await client.messages.parse({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system: `An investor (LP) replied to a deal email from RJL Capital Advisors about "${deal?.propertyName ?? deal?.name}" sponsored by ${deal?.sponsorName ?? "the sponsor"}. Extract what they asked for and where they stand. Only real requests; ignore pleasantries. If the email is an auto-reply or out-of-office, return no asks and stance unclear.`,
        messages: [{ role: "user", content: `From ${a.company?.name} (${[a.contact?.firstName, a.contact?.lastName].filter(Boolean).join(" ")}), subject "${a.subject ?? ""}":\n\n${body}` }],
        output_config: { format: zodOutputFormat(Out) },
      });
      parsed = res.parsed_output;
    } catch {
      parsed = null;
    }
    await prisma.lpAskScan.create({ data: { externalId: a.externalId!, result: parsed ? `${parsed.asks.length} asks` : "error" } }).catch(() => {});
    if (!parsed) continue;
    // progress report: note + status
    const dateTag = a.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const rows = await prisma.dealInvestor.findMany({ where: { dealId, contact: { companyId: a.companyId! } } });
    const newStatus = parsed.stance === "pass" ? 8 : parsed.stance === "interested" ? 5 : parsed.stance === "reviewing" ? 4 : null;
    for (const r of rows) {
      const note = parsed.note ? `${parsed.note} (${dateTag})` : null;
      await prisma.dealInvestor.update({ where: { id: r.id }, data: { ...(note ? { note: r.note ? `${r.note} | ${note}` : note, noteDate: a.occurredAt } : {}), ...(newStatus && newStatus > r.status && r.status < 6 ? { status: newStatus } : {}), updatedAt: a.occurredAt } });
    }
    if (parsed.asks.length) {
      // anything the sponsor already told us (Questions answered on the ticket) gets surfaced with the ask
      const { factsFor } = await import("@/lib/deal-knowledge");
      const answered: { ask: string; answer: string }[] = [];
      for (const ask of parsed.asks) {
        const hit = (await factsFor(dealId, ask, 1))[0];
        if (hit) answered.push({ ask, answer: hit.answer });
      }
      out.push({ dealId, lpCompanyId: a.companyId!, lpName: a.company!.name, asks: parsed.asks, answered, note: parsed.note, stance: parsed.stance, messageId: a.externalId!, contactId: a.contactId, at: a.occurredAt });
    }
  }
  return out;
}
