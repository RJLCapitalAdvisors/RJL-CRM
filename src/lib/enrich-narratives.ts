import { US_STATES } from "@/lib/taxonomy";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { cleanBusinessPlan, houseText, planProblems, stripDashes, cleanSponsorBio, planSentences } from "@/lib/style";

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

const Plan = z.object({
  plan: z.string().describe("The business plan paragraph, 4 to 6 sentences of flowing prose."),
  thesis: z.string().describe("One line: the value-add thesis the paragraph carries (what the sponsor will do to create value), as a check that it is there."),
});

/**
 * The business plan, written on its own from the whole package when a ticket is made (Jonathan, Oct 12, 2026: Citivest's Hedges
 * Greene came in without the one thing the deal is about, backfilling the Staples box with a grocer). The general extractor
 * writes the plan as one field among sixty and the no-figures filter then cut whole sentences, the thesis with them. This call
 * has one job, the thesis is required, figures are forbidden in words as well as digits, and a sentence the filter would still
 * cut is sent back once to be said in words. Returns the plan written, or null when nothing usable came back.
 */
/** The plan's first sentence names the place: the city, the state, the property or its neighborhood (Jonathan, Oct 19, 2026). */
export function leadsWithPlace(plan: string, deal: { city: string | null; state: string | null; propertyName: string | null; name: string }): boolean {
  const first = planSentences(plan)[0] ?? "";
  const f = first.toLowerCase();
  const needles = [deal.city, deal.state ? US_STATES[deal.state] ?? deal.state : null, deal.propertyName].filter((x): x is string => Boolean(x && x.trim().length >= 3)).map((x) => x.toLowerCase());
  return needles.length === 0 || needles.some((n) => f.includes(n));
}

export async function writeBusinessPlan(dealId: string, text: string, source: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || text.trim().length < 300) return null;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { name: true, propertyName: true, sponsorName: true, assetClass: true, strategy: true, city: true, state: true, summary: true, sponsorCompanyId: true } });
  if (!deal) return null;
  const system = [
    "You write the business plan paragraph of a real estate capital raise email for RJL Capital Advisors. Plain, factual, professional prose an institutional investor reads in thirty seconds.",
    "Shape, in this order: where the property is and the market context; the anchor or key tenants (or the resident base); THE VALUE-ADD THESIS; notable physical attributes. 4 to 6 sentences.",
    "The FIRST sentence names the property or site and where it is: the city and state or the submarket and metro, and what surrounds it (the corridor, the transit, the employers). Never open with the sponsor or with what is being built; the place comes first, as in 'Aurea at Highland Park sits at the gateway of Miami's urban core' or 'The site sits at the seam of Boerum Hill, Park Slope and Gowanus in Brooklyn'.",
    "The value-add thesis is the point of the paragraph and must never be left out: what the sponsor will do to create value, in concrete terms. A departing tenant and who backfills it (a grocer for the Staples box), vacancy and who it is leased to, a repositioning, a renovation program, an entitlement, a development. Name the tenant, the space and the intended use in words.",
    "No figures of any kind, in digits or in words: no percentages, dollars, rents, dates, years, square footage, unit counts, returns, cap rates, prices, costs or timelines, and nothing about the seller, the lender, the exit, the closing or how the deal was sourced. Every one of those has its own field. Say 'well above the in-place rent', never a number.",
    "A physical descriptor of the site (riverfront, waterfront, lakeside, hilltop, wooded, corner) is stated only when the material's own site plan or description says it of this site; never inferred from the town's general description. A site near a highway and a lake is near them, not on a river.",
    "Never name investor groups. No dashes as punctuation, no bullet points, no headings.",
  ].join(" ");
  const client = new Anthropic();
  let plan: string | null = null;
  try {
    const res = await client.messages.parse({ model: "claude-sonnet-5", max_tokens: 1500, system, messages: [{ role: "user", content: `DEAL: ${deal.propertyName ?? deal.name}${deal.city ? ` (${deal.city}, ${deal.state ?? ""})` : ""}\nSPONSOR: ${deal.sponsorName ?? "unknown"}\nASSET CLASS: ${deal.assetClass ?? ""} · STRATEGY: ${deal.strategy ?? ""}\n\nTHE MATERIAL (${source}):\n${text.slice(0, 60000)}` }], output_config: { format: zodOutputFormat(Plan) } });
    plan = res.parsed_output?.plan ?? null;
    // a sentence the no-figures filter would cut goes back once, to be said in words rather than lost
    const bad = [...planProblems(plan), ...(plan && !leadsWithPlace(plan, deal) ? ["The first sentence does not say where the property is: open with the city, state or submarket and the surroundings."] : [])];
    if (plan && bad.length) {
      const again = await client.messages.parse({ model: "claude-sonnet-5", max_tokens: 1500, system, messages: [{ role: "user", content: `This paragraph was written for ${deal.propertyName ?? deal.name}:\n\n${plan}\n\nThese sentences carry a figure or a fact that has its own field and would be cut: \n${bad.map((b) => `- ${b}`).join("\n")}\n\nRewrite the whole paragraph keeping every sentence's substance (the value-add thesis above all) with those things said in words or left out. 4 to 6 sentences.` }], output_config: { format: zodOutputFormat(Plan) } });
      plan = again.parsed_output?.plan ?? plan;
    }
  } catch (e) {
    console.error("business plan write failed", dealId, String(e).slice(0, 200));
    return null;
  }
  const out = cleanBusinessPlan(stripDashes(plan));
  if (!out || out.length < 120) return null;
  await prisma.deal.update({ where: { id: dealId }, data: { summary: out } });
  return out;
}

const PLACEHOLDER = /^(?:see |as |is |please see )?attached\.?$|^n\/?a$|^tbd$|^-+$/i;
const thin = (s: string | null | undefined) => !s || s.trim().length < 60 || PLACEHOLDER.test(s.trim());

export async function improveNarratives(dealId: string, text: string, source: string): Promise<{ summary: boolean; bio: boolean }> {
  const none = { summary: false, bio: false };
  if (!process.env.ANTHROPIC_API_KEY || text.trim().length < 200) return none;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { name: true, propertyName: true, sponsorName: true, assetClass: true, strategy: true, city: true, state: true, summary: true, sponsorExperience: true, sponsorCompanyId: true } });
  if (!deal) return none;
  let out: z.infer<typeof Out> | null = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) try {
    const res = await new Anthropic().messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 4000, // the reply carries its reasoning too; 1,500 cut Sunder's answers off mid-string (Sep 28, 2026)
      system: [
        "You keep the narrative on a deal ticket at RJL Capital Advisors, a real estate capital advisor, current as the sponsor sends more material. You are given the ticket's business plan and sponsor bio as they stand and a new email (with any attachments' text).",
        "Keep each paragraph exactly as it is unless the new material adds real substance about the property, the market, the plan or the sponsor; then rewrite that paragraph in the house shape, keeping what was right and folding the new substance in. A current text that is a placeholder or a stub is replaced whenever the material describes the thing.",
        "Never invent. The business plan is 4 to 6 sentences and carries no numbers at all: no rents, prices, dollar figures, percentages, returns, dates, unit counts or square footage, and nothing about the seller, the lender, the closing timeline or the exit; every one of those has its own field on the ticket. Its first sentence names the property or site and where it is (city and state, submarket, surroundings); a physical descriptor of the site (riverfront, lakeside, hilltop) only when the material says it of this site, never inferred from the town. The bio is 3 to 4 sentences about the firm only: history, geography, focus and track record; a principal is named by name and role, never by family relation ('X's father'); scale (dollars of acquisitions, units owned) may appear there, return figures may not, and nothing about this deal (its approvals, zoning, grants, brokers or lenders) belongs in it. Never name investor groups. No dashes as punctuation, no bullet points, plain professional prose an investor could read.",
      ].join(" "),
      messages: [{ role: "user", content: `DEAL: ${deal.propertyName ?? deal.name}${deal.city ? ` (${deal.city}, ${deal.state ?? ""})` : ""}\nSPONSOR: ${deal.sponsorName ?? "unknown"}\nASSET CLASS: ${deal.assetClass ?? ""} · STRATEGY: ${deal.strategy ?? ""}\n\nCURRENT BUSINESS PLAN:\n${deal.summary?.trim() || "(none)"}\n\nCURRENT SPONSOR BIO:\n${thin(deal.sponsorExperience) ? `(placeholder: "${deal.sponsorExperience ?? ""}")` : deal.sponsorExperience}\n\nNEW MATERIAL (${source}):\n${text.slice(0, 40000)}` }],
      output_config: { format: zodOutputFormat(Out) },
    });
    out = res.parsed_output;
  } catch (e) {
    console.error("narrative enrichment failed", dealId, `attempt ${attempt + 1}`, String(e).slice(0, 200)); // a malformed structured reply is tried once more
  }
  if (!out) return none;
  if (process.env.NARRATIVE_DEBUG) console.log("narrative reply:", JSON.stringify(out).slice(0, 3000));
  if (!out.summaryChanged && !out.bioChanged) console.log("narratives unchanged on", deal.propertyName ?? deal.name, "from", source, ":", out.why);
  const data: Record<string, string> = {};
  const summary = cleanBusinessPlan(stripDashes(out.summary));
  if (out.summaryChanged && summary && summary !== deal.summary && summary.length > 120) data.summary = summary;
  const bio = cleanSponsorBio(stripDashes(out.sponsorExperience));
  if (out.bioChanged && bio && bio !== deal.sponsorExperience && bio.length > 60) data.sponsorExperience = bio;
  if (!Object.keys(data).length) return none;
  await prisma.deal.update({ where: { id: dealId }, data });
  const what = [data.summary ? "business plan" : "", data.sponsorExperience ? "sponsor info" : ""].filter(Boolean).join(" and ");
  await prisma.activity.create({ data: { type: "NOTE", dealId, companyId: deal.sponsorCompanyId, body: stripDashes(`${what[0].toUpperCase()}${what.slice(1)} updated from ${source}: ${out.why}`) } }).catch(() => null);
  return { summary: Boolean(data.summary), bio: Boolean(data.sponsorExperience) };
}
