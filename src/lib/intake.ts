import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ASSET_CLASSES, US_STATES } from "@/lib/taxonomy";
import { CHECKLIST, missingFor, type DealLikeForChecklist } from "@/lib/checklist";

// Checklist answers Claude should look for in the email (items without a core column).
const detailShape = Object.fromEntries(
  CHECKLIST.filter((it) => !it.core).map((it) => [it.key, z.string().nullable().describe(`${it.label}. ${it.question}${it.kind === "doc" ? ' Say "Received" if the document is attached or clearly provided, otherwise describe what was said or null.' : ""}`)])
);

export const ExtractedDealSchema = z.object({
  sponsorName: z.string().nullable().describe("Company sponsoring / acquiring the deal (not the broker or forwarder)"),
  propertyName: z.string().nullable(),
  propertyAddress: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable().describe("Two-letter US state code"),
  assetClass: z.string().nullable().describe(`One of: ${ASSET_CLASSES.join(", ")}`),
  strategy: z.enum(["Acquisitions", "Development"]).nullable(),
  requestType: z.enum(["Equity", "Debt", "Both"]).nullable(),
  requestedAmount: z.number().nullable().describe("US dollars, e.g. 12000000"),
  purchasePrice: z.number().nullable().describe("Purchase price or total project cost in USD"),
  totalEquity: z.number().nullable(),
  ltv: z.number().nullable().describe("Percent, e.g. 65 (LTV or LTC)"),
  loanTerm: z.string().nullable(),
  equityMultiple: z.number().nullable(),
  occupancy: z.number().nullable().describe("Percent"),
  onMarket: z.boolean().nullable(),
  sponsorExperience: z.string().nullable().describe("Sponsor bio: overall and local market experience"),
  summary: z.string().nullable().describe("2-4 sentence neutral summary of the deal and business plan for an investor email"),
  details: z.object(detailShape),
  contactName: z.string().nullable().describe("Name of the person who sent the deal"),
  contactEmail: z.string().nullable(),
  confidenceNotes: z.string().nullable().describe("Anything ambiguous or inferred"),
});
export type ExtractedDeal = z.infer<typeof ExtractedDealSchema>;

export const EMPTY: ExtractedDeal = {
  sponsorName: null, propertyName: null, propertyAddress: null, city: null, state: null, assetClass: null, strategy: null,
  requestType: null, requestedAmount: null, purchasePrice: null, totalEquity: null, ltv: null, loanTerm: null, equityMultiple: null,
  occupancy: null, onMarket: null, sponsorExperience: null, summary: null,
  details: Object.fromEntries(CHECKLIST.filter((it) => !it.core).map((it) => [it.key, null])) as ExtractedDeal["details"],
  contactName: null, contactEmail: null, confidenceNotes: null,
};

export function toChecklistDeal(d: ExtractedDeal): DealLikeForChecklist {
  return { strategy: d.strategy, assetClass: d.assetClass, occupancy: d.occupancy, summary: d.summary, sponsorExperience: d.sponsorExperience, onMarket: d.onMarket, ltv: d.ltv, loanTerm: d.loanTerm, details: d.details as Record<string, string | null> };
}

/** Keys of checklist items still unanswered, given the deal's strategy and asset class. */
export function missingItems(d: ExtractedDeal): string[] {
  return missingFor(toChecklistDeal(d)).map((it) => it.key);
}

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------- Claude extraction ----------
const SYSTEM = `You extract commercial real estate deal details from emails forwarded to a capital advisory firm (RJL Capital Advisors) so the team can see what the sponsor provided and what is still missing.
Read the email (including quoted/forwarded content) and fill the schema. Rules:
- Use null for anything not stated. Never invent numbers or facts.
- Dollar amounts are plain numbers in USD ("$12.5MM" -> 12500000, "$3,200,000" -> 3200000).
- Percentages are plain numbers (65% -> 65). LTV may appear as LTC or leverage.
- requestType: "Equity" for JV/LP/pref/co-GP equity raises, "Debt" for loans/bridge/construction/refi, "Both" if both.
- strategy: "Development" for ground-up / construction; "Acquisitions" for buying an existing asset.
- assetClass must be one of the listed values; map synonyms (apartments -> Multifamily, BTR -> Build-For-Rent (SFR), hotel -> Hospitality, warehouse -> Industrial, shopping center -> Retail).
- state is the two-letter code. If only a metro is given, infer the state and note it in confidenceNotes.
- For each checklist item in details: quote or closely paraphrase what the sponsor said. For documents (proforma, rent roll/T12, trade-out report, capex budget, comps) answer "Received" only if the document is attached or explicitly provided; otherwise null.
- summary is a neutral 2-4 sentence description suitable for an investor email.`;

export async function extractWithClaude(rawText: string, subject?: string | null, attachments: string[] = []): Promise<ExtractedDeal> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Subject: ${subject ?? ""}\nAttachments: ${attachments.length ? attachments.join(", ") : "(none)"}\n\n${rawText}` }],
    output_config: { format: zodOutputFormat(ExtractedDealSchema) },
  });
  if (response.stop_reason === "refusal") throw new Error("Extraction was refused by the model");
  if (!response.parsed_output) throw new Error("Model returned no structured output");
  return response.parsed_output;
}

// ---------- Heuristic fallback (no API key) ----------
const money = (s: string): number | null => {
  const m = s.match(/\$\s?([\d,.]+)\s*(mm|m|million|k|bn|b)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "mm" || unit === "m" || unit === "million") n *= 1_000_000;
  else if (unit === "k") n *= 1_000;
  else if (unit === "bn" || unit === "b") n *= 1_000_000_000;
  return n;
};
const pctAfter = (text: string, re: RegExp): number | null => {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return isNaN(n) ? null : n;
};
const lineAfter = (text: string, re: RegExp): string | null => {
  const m = text.match(re);
  return m ? m[1].trim().slice(0, 300) : null;
};

export function extractHeuristic(rawText: string, subject?: string | null, fromName?: string | null, fromEmail?: string | null, attachments: string[] = []): ExtractedDeal {
  const text = rawText.replace(/\r/g, "");
  const lower = text.toLowerCase();
  const d: ExtractedDeal = { ...EMPTY, details: { ...EMPTY.details }, contactName: fromName ?? null, contactEmail: fromEmail ?? null };

  const acMap: [RegExp, string][] = [
    [/multifamily|multi-family|apartment|\bunits\b/, "Multifamily"],
    [/build[- ]to[- ]rent|\bbtr\b|\bsfr\b|single[- ]family/, "Build-For-Rent (SFR)"],
    [/student housing/, "Student Housing"],
    [/senior (housing|living)|assisted living/, "Senior Housing"],
    [/self[- ]storage/, "Self Storage"],
    [/hotel|hospitality|resort/, "Hospitality"],
    [/industrial|warehouse|logistics|distribution/, "Industrial"],
    [/medical office|\bmob\b/, "Medical Office"],
    [/office/, "Office"],
    [/retail|shopping center|strip center|grocery/, "Retail"],
    [/mixed[- ]use/, "Mixed Use"],
    [/\bland\b|entitled/, "Land"],
  ];
  d.assetClass = acMap.find(([re]) => re.test(lower))?.[1] ?? null;
  d.strategy = /development|ground[- ]up|construction loan|entitle|shovel/.test(lower) ? "Development" : /acqui|purchase|under contract|\bpsa\b/.test(lower) ? "Acquisitions" : null;
  const debt = /\b(loan|debt|bridge|refinanc|lender|ltv|ltc|senior|mezz)\b/.test(lower);
  const equity = /\b(equity|jv|lp|co-?gp|pref(erred)?|raise)\b/.test(lower);
  d.requestType = debt && equity ? "Both" : debt ? "Debt" : equity ? "Equity" : null;

  const req = text.match(/(?:seeking|raising|looking for|requesting|need|request(?:ed)?|loan amount|equity (?:raise|need|request))[^$\n]{0,40}(\$\s?[\d,.]+\s*(?:mm|m|million|k)?)/i);
  d.requestedAmount = req ? money(req[1]) : null;
  const pp = text.match(/(?:purchase price|acquisition price|total (?:project )?cost|price)[^$\n]{0,30}(\$\s?[\d,.]+\s*(?:mm|m|million|k)?)/i);
  d.purchasePrice = pp ? money(pp[1]) : null;
  const te = text.match(/(?:total equity|equity required|equity check)[^$\n]{0,30}(\$\s?[\d,.]+\s*(?:mm|m|million|k)?)/i);
  d.totalEquity = te ? money(te[1]) : null;
  d.ltv = pctAfter(text, /(\d{2}(?:\.\d+)?)\s*%\s*(?:ltv|ltc|leverage)/i) ?? pctAfter(text, /(?:ltv|ltc|leverage)[^\d\n]{0,15}(\d{2}(?:\.\d+)?)\s*%/i);
  d.occupancy = pctAfter(text, /(\d{2,3}(?:\.\d+)?)\s*%\s*(?:occupied|occupancy|leased)/i) ?? pctAfter(text, /(?:occupancy|occupied|leased)[^\d\n]{0,15}(\d{2,3}(?:\.\d+)?)\s*%/i);
  const em = text.match(/(\d(?:\.\d+)?)\s*x\s*(?:equity multiple|em\b|multiple)/i) ?? text.match(/(?:equity multiple|multiple)[^\d\n]{0,15}(\d(?:\.\d+)?)\s*x/i);
  d.equityMultiple = em ? Number(em[1]) : null;
  d.loanTerm = lineAfter(text, /(?:loan term|term)[:\s-]+([^\n]{2,60})/i);
  d.onMarket = /off[- ]market/.test(lower) ? false : /on[- ]market|listed with|broker(ed)? by/.test(lower) ? true : null;
  d.propertyAddress = lineAfter(text, /(\d{2,6}\s+[A-Za-z0-9.'\- ]{3,40}\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway|Ct|Court|Pl|Place)\b[^\n]{0,60})/);
  for (const [code, name] of Object.entries(US_STATES)) {
    if (new RegExp(`\\b${code}\\b`).test(text) || lower.includes(name.toLowerCase())) {
      d.state = code;
      break;
    }
  }
  const cityState = text.match(/([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?),\s*([A-Z]{2})\b/);
  if (cityState) {
    d.city = cityState[1];
    d.state = d.state ?? cityState[2];
  }
  d.sponsorName =
    lineAfter(text, /(?:sponsor|borrower|developer|buyer)[:\s-]+([^\n,.]{2,60})/i)
      ?.replace(/\s+(?:is|are|has|have|we)\b.*$/i, "")
      .trim() || null;
  d.propertyName = subject?.replace(/^(fwd?|re|fw):\s*/gi, "").trim() || null;
  d.sponsorExperience = lineAfter(text, /(?:track record|experience|has (?:developed|acquired|completed))[^\n]{0,5}[:\s-]*([^\n]{5,200})/i);

  const det = d.details as Record<string, string | null>;
  det.timeline = lineAfter(text, /(?:clos(?:e|ing)|timeline|hard money|due diligence)[^\n]{0,10}[:\s-]+([^\n]{2,80})/i);
  det.lender = lineAfter(text, /(?:lender|financing (?:from|by)|loan from)[:\s-]+(?:an?\s+)?([^\n,.]{2,60})/i);
  const debtLine = lineAfter(text, /((?:\d{2}%\s*(?:LTV|LTC)|(?:bridge|construction|senior|agency|permanent) loan|debt:)[^\n]{0,160})/i);
  det.debtTerms = debtLine ?? (d.ltv != null ? `${d.ltv}% LTV${d.loanTerm ? ", " + d.loanTerm : ""}` : null);
  det.sellerProfile = lineAfter(text, /seller(?: profile| is| type)?[:\s-]+([^\n]{2,80})/i);
  det.acres = lineAfter(text, /([\d.]+)\s*(?:acres?|ac\b)/i);
  det.opportunityZone = /opportunity zone|\boz\b/.test(lower) ? "Yes" : null;
  det.affordable = /affordable|lihtc|income[- ]restricted|section 8/.test(lower) ? "Yes – mentioned" : null;
  det.sourcing = d.onMarket == null ? null : d.onMarket ? "On market" : "Off market";
  const docs: [string, RegExp][] = [
    ["proforma", /pro ?forma|underwriting model|\.xlsx?/i],
    ["rentRollT12", /rent roll|t-?12|trailing[- ]12/i],
    ["leaseTradeOut", /trade[- ]out/i],
    ["capexBudget", /capex|capital (?:expenditure|budget)/i],
    ["comps", /\bcomps?\b|comparables/i],
  ];
  const attachText = attachments.join(" ");
  for (const [k, re] of docs) if (re.test(attachText) || /attached|see attached|enclosed/.test(lower) && re.test(text)) det[k] = "Received";
  d.summary = null;
  d.confidenceNotes = "Parsed with the basic pattern matcher (no Claude API key configured). Please verify every field.";
  return d;
}

export async function extractDeal(rawText: string, subject?: string | null, fromName?: string | null, fromEmail?: string | null, attachments: string[] = []): Promise<{ data: ExtractedDeal; extractor: string }> {
  if (claudeConfigured()) {
    const data = await extractWithClaude(rawText, subject, attachments);
    return { data: { ...data, contactName: data.contactName ?? fromName ?? null, contactEmail: data.contactEmail ?? fromEmail ?? null }, extractor: "claude" };
  }
  return { data: extractHeuristic(rawText, subject, fromName, fromEmail, attachments), extractor: "heuristic" };
}
