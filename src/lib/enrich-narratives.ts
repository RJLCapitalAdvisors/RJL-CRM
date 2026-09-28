import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { cleanBusinessPlan, houseText, stripDashes } from "@/lib/style";

/**
 * Follow-on material improves the ticket's two narratives (Jonathan, Sep 28, 2026: Certes sent a write-up, a sponsor
 * deck and Sunder's answers after intake, and the ticket kept "Attached" as the sponsor info and the first business
 * plan). Every later email on a deal (deals@ follow-ups, the sponsor's replies) is held against the business plan and
 * the sponsor bio: when it adds real substance the paragraph is rewritten in the house shape, otherwise the text stays.
 * Figures never go in the prose: they have fields.
 */
const Out = z.object({
  summary: z.string().describe("The business plan paragraph to keep on the ticket: the current one unchanged when the new material adds nothing, otherwise rewritten to take the new substance in. 4 to 6 sentences of flowing prose. Lead with location and market context, then the anchor or key tenants (or the resident base), the value-add opportunity, notable physical attributes. No return projections, dollar figures, metrics, seller profile, lender, close timeline, year built, square footage or unit count. No dashes as punctuation. Never name any investor group."),
  summaryChanged: z.boolean().describe("True only when the summary was rewritten with new substance."),
  sponsorExperience: z.string().describe("The sponsor bio to keep on the ticket: the current one unchanged when the new material adds nothing, otherwise rewritten. 3 to 4 sentences: founding background, focus and strategy, scale and track record. No return figures, no dashes. Empty only when nothing is known about the sponsor at all."),
  bioChanged: z.boolean().describe("True only when the bio was rewritten with new substance (a placeholder like 'Attached' or a one-line stub counts as nothing)."),
  why: z.string().describe("One short line: what the new material added, or 'nothing new'."),
});

const PLACEHOLDER = /^(?:see |as |is |please see )?attached\.?$|^n\/?a$|^tbd$|^-+$/i;
const thin = (s: string | null | undefined) => !s || s.trim().length < 60 || PLACEHOLDER.test(s.trim());

export async function improveNarratives(dealId: string, text: string, source: string): Promise<{ summary: boolean; bio: boolean }> {
  const none = { summary: false, bio: false };
  if (!process.env.ANTHROPIC_API_KEY || text.trim().length < 200) return none;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { name: true, propertyName: true, sponsorName: true, assetClass: true, strategy: true, city: true, state: true, summary: true, sponsorExperience: true, sponsorCompanyId: true } });
  if (!deal) return none;
  let out: z.infer<typeof Out> | null = null;
  try {
    const res = await new Anthropic().messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system: [
        "You keep the narrative on a deal ticket at RJL Capital Advisors, a real estate capital advisor, current as the sponsor sends more material. You are given the ticket's business plan and sponsor bio as they stand and a new email (with any attachments' text).",
        "Keep each paragraph exactly as it is unless the new material adds real substance about the property, the market, the plan or the sponsor; then rewrite that paragraph in the house shape, keeping what was right and folding the new substance in. A current text that is a placeholder or a stub is replaced whenever the material describes the thing.",
        "Never invent. Never put figures, returns, prices or dates into the prose. Never name investor groups, lenders by name are fine. No dashes as punctuation, no bullet points, plain professional prose an investor could read.",
      ].join(" "),
      messages: [{ role: "user", content: `DEAL: ${deal.propertyName ?? deal.name}${deal.city ? ` (${deal.city}, ${deal.state ?? ""})` : ""}\nSPONSOR: ${deal.sponsorName ?? "unknown"}\nASSET CLASS: ${deal.assetClass ?? ""} · STRATEGY: ${deal.strategy ?? ""}\n\nCURRENT BUSINESS PLAN:\n${deal.summary?.trim() || "(none)"}\n\nCURRENT SPONSOR BIO:\n${thin(deal.sponsorExperience) ? `(placeholder: "${deal.sponsorExperience ?? ""}")` : deal.sponsorExperience}\n\nNEW MATERIAL (${source}):\n${text.slice(0, 40000)}` }],
      output_config: { format: zodOutputFormat(Out) },
    });
    out = res.parsed_output;
  } catch (e) {
    console.error("narrative enrichment failed", dealId, String(e).slice(0, 200));
    return none;
  }
  if (!out) return none;
  const data: Record<string, string> = {};
  const summary = cleanBusinessPlan(stripDashes(out.summary));
  if (out.summaryChanged && summary && summary !== deal.summary && summary.length > 120) data.summary = summary;
  const bio = houseText(stripDashes(out.sponsorExperience));
  if (out.bioChanged && bio && bio !== deal.sponsorExperience && bio.length > 60) data.sponsorExperience = bio;
  if (!Object.keys(data).length) return none;
  await prisma.deal.update({ where: { id: dealId }, data });
  const what = [data.summary ? "business plan" : "", data.sponsorExperience ? "sponsor info" : ""].filter(Boolean).join(" and ");
  await prisma.activity.create({ data: { type: "NOTE", dealId, companyId: deal.sponsorCompanyId, body: stripDashes(`${what[0].toUpperCase()}${what.slice(1)} updated from ${source}: ${out.why}`) } }).catch(() => null);
  return { summary: Boolean(data.summary), bio: Boolean(data.sponsorExperience) };
}
