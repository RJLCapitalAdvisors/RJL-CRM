import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isSponsorSide } from "@/lib/report-guard";
import { ASSET_CLASSES, DEAL_STAGES } from "@/lib/taxonomy";
import { bestContactForCompany } from "@/lib/engagement";
import { logActivity } from "@/lib/activity";

/**
 * Instructions to deals@. When a teammate forwards a deal they can write a line above it, e.g.
 * "intro to sponsor made", "UFUND already copied", "engagement letter signed", "put this in underwritten".
 * We read that note and act on it: move the ticket to the named stage, put already-introduced investors on
 * the progress report as Intro Made, and keep the note on the ticket.
 */

const Out = z.object({
  stage: z.enum([...DEAL_STAGES, ""]).describe("Pipeline stage the note asks for, mapped to the closest stage. 'intro made' / 'introduced to the sponsor' -> Intro To Capital Made; 'engagement letter sent/signed' -> that stage; 'underwriting' -> Deal Underwritten; 'taken out' / 'in market' -> Deal Taken To Market. Empty if the note does not say."),
  investorsIntroduced: z.array(z.string()).describe("Names of investor groups the note says were already introduced to the sponsor / copied on the deal (e.g. 'UFUND')."),
  strategy: z.enum(["Acquisitions", "Development", ""]).describe("When the note says what kind of deal this is: 'acquisition', 'existing asset', 'recap', 'refi' -> Acquisitions; 'development', 'ground-up', 'construction' -> Development. Empty when the note does not say (Jonathan, Sep 16: 'This is an acquisition. Please treat it as such.' must land)."),
  assetClass: z.enum([...ASSET_CLASSES, ""]).describe("When the note names the property type ('this is retail', 'a multifamily deal'), the matching listed value; otherwise empty."),
  note: z.string().describe("The instruction in the forwarder's words, trimmed. Empty if there was no note."),
});

/** Text the forwarder typed above the forwarded message (before the first From:/Original Message header). */
export function forwarderNote(bodyText: string): string {
  const cut = bodyText.search(/^\s*(From:|-----\s*Original Message|Begin forwarded message|On .{5,80} wrote:)/im);
  const head = (cut >= 0 ? bodyText.slice(0, cut) : bodyText.slice(0, 600)).replace(/\s+/g, " ").trim();
  // drop a signature-looking tail (name + phone) and very short throwaways
  return head.length > 2 ? head.slice(0, 800) : "";
}

const STAGE_ORDER = DEAL_STAGES as readonly string[];

export async function applyForwarderInstructions(dealId: string, bodyText: string): Promise<{ stage?: string; introduced: string[] } | null> {
  const note = forwarderNote(bodyText);
  if (!note || !process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 400,
    system: `A teammate at RJL Capital Advisors forwarded a deal to the deals@ mailbox and typed a short note above it. Read only that note and return any instructions it carries about the CRM ticket. Ignore signatures and greetings. If the note is just "FYI" or empty, return nothing.`,
    messages: [{ role: "user", content: note }],
    output_config: { format: zodOutputFormat(Out) },
  });
  const out = res.parsed_output;
  if (!out) return null;
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return null;
  const introduced: string[] = [];
  for (const name of out.investorsIntroduced) {
    const co = await prisma.company.findFirst({ where: { name: { contains: name.split(/\s+/)[0], mode: "insensitive" }, roles: { contains: "Investor" } }, orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } } });
    if (!co) continue;
    const c = await bestContactForCompany(co.id);
    if (!c) continue;
    const exists = await prisma.dealInvestor.findFirst({ where: { dealId, contactId: c.id } });
    if (exists) await prisma.dealInvestor.update({ where: { id: exists.id }, data: { status: Math.max(exists.status, 6) } });
    else if (!(await isSponsorSide(dealId, c.id))) await prisma.dealInvestor.create({ data: { dealId, contactId: c.id, status: 6, note: `Introduced before the deal came in (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`, noteDate: new Date() } });
    introduced.push(co.name);
  }
  let stage = out.stage || undefined;
  if (!stage && introduced.length) stage = "Intro To Capital Made";
  const details = (() => {
    try {
      return JSON.parse(deal.details || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      ...(stage && STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(deal.stage) ? { stage } : {}),
      ...(out.strategy ? { strategy: out.strategy } : {}), // the teammate's word beats the extractor's guess
      ...(out.assetClass ? { assetClass: out.assetClass } : {}),
      details: JSON.stringify({ ...details, forwarderNote: out.note || note }),
    },
  });
  if (out.note || stage || introduced.length || out.strategy || out.assetClass) await logActivity({ type: "NOTE", body: `Forwarder's instructions: ${out.note || note}${stage ? ` -> ${stage}` : ""}${out.strategy ? ` -> ${out.strategy}` : ""}${out.assetClass ? ` -> ${out.assetClass}` : ""}${introduced.length ? ` -> ${introduced.join(", ")} marked Intro Made` : ""}`, dealId, companyId: deal.sponsorCompanyId });
  return { stage, introduced };
}
