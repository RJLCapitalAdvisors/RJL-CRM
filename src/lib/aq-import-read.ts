import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AQ_STAGES, normalizePhone, parseJsonList } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { findProperty, type HoldGuess } from "@/lib/aq-import";
import { importInstructionsText } from "@/lib/aq-import-instructions";
import { loadDataRules } from "@/lib/data-rules";
import { dialed, isBadNumber, lastCallOf, tagsOf, type PropertyGroup } from "@/lib/aq-terakotta";

/**
 * The judgment half of the Import section (Oct 7, 2026). Code has already folded the file into properties
 * (aq-terakotta.ts); Claude reads only the calls (tags, notes, transcripts, who picked up) of a handful of properties
 * at a time, with Shawn's Import instructions and Data rules, plus what the CRM already holds for each, and returns one
 * reading per property: the call result, the deal lists, junk, a question for Shawn, and a one-line why. Small
 * batches never get clipped, and every property in the batch must come back or it is read again; one that still does
 * not is held for Shawn rather than dropped. A property nobody dialed, with no tags and no sign of a duplicate, is
 * settled by rule without a model call.
 */

export const READ_MODEL = "claude-opus-5-5";

export type Reading = {
  outcome: "live" | "junk" | "hold";
  callResult?: string; // one of AQ_STAGES; absent leaves the CRM's result alone
  callBackDate?: string; // yyyy-mm-dd
  pipeline?: boolean;
  priority?: number;
  deal?: boolean;
  dealStage?: string;
  junkReason?: string;
  question?: string;
  guess?: HoldGuess;
  why: string;
  autoNote?: string; // "(auto) …" summary for an untagged real conversation
  callPerson?: string; // person key, "operator", or absent (the main owner)
  primary?: { person: string; phone: string }[]; // digits
  wrong?: { phone: string; reason: string }[];
  extraPhones?: { person: string; phone: string }[];
  emails?: { person: string; email: string }[];
  operatorPerson?: { name: string; phone?: string; email?: string };
  ownerRunsBusiness?: string[];
  expandingOperator?: string;
  buyer?: string;
  propertyNote?: string;
  skipTranscripts?: string[]; // digits of the numbers whose transcript is only a greeting or a machine
  by: "claude" | "rule" | "fallback";
};
export type CrmContext = { id: string; junk: string | null; result: string | null; lastCall: string | null; pipeline: boolean; dealStage: string | null; isDeal: boolean } | null;

const d10 = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const nameKey = (s: string | undefined) => (s ?? "").toLowerCase().replace(/\b(inc|llc|corp|co|ltd)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
const vacant = (s: string | undefined) => !s || /vacant|unconfirmed|^n\/?a$/i.test(s);

/** What the CRM already holds for each property in the file (matched by parcel, then address and town). */
export async function crmContexts(groups: PropertyGroup[]): Promise<Record<string, CrmContext>> {
  const out: Record<string, CrmContext> = {};
  for (const g of groups) {
    const f = await findProperty(g.facts.address, g.facts.parcelId, g.facts.city);
    if (!f) {
      out[g.key] = null;
      continue;
    }
    const stages = parseJsonList(f.stages);
    out[g.key] = { id: f.id, junk: f.junkedAt ? f.junkReason ?? "junk" : null, result: stages[0] ?? null, lastCall: d10(f.lastCallDate), pipeline: Boolean(f.pipelineAt), dealStage: f.dealStage, isDeal: stages.includes("Deal") };
  }
  return out;
}

/** Signs a property may be a duplicate: the same phone or business as another property in this file or in the CRM. */
export async function duplicateHints(groups: PropertyGroup[], ctx: Record<string, CrmContext>): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const byPhone = new Map<string, PropertyGroup[]>();
  const byBiz = new Map<string, PropertyGroup[]>();
  for (const g of groups) {
    for (const p of g.phones) byPhone.set(p.digits, [...(byPhone.get(p.digits) ?? []), g]);
    if (!vacant(g.facts.businessName)) byBiz.set(nameKey(g.facts.businessName), [...(byBiz.get(nameKey(g.facts.businessName)) ?? []), g]);
  }
  const reached = (g: PropertyGroup) => (g.phones.some(dialed) ? "dialed in this file" : "not dialed in this file");
  for (const g of groups) {
    const hints = new Set<string>();
    for (const p of g.phones) for (const o of byPhone.get(p.digits) ?? []) if (o !== g) hints.add(`shares ${p.number} with ${o.facts.address}, ${o.facts.city ?? ""} (${reached(o)})`);
    if (!vacant(g.facts.businessName)) for (const o of byBiz.get(nameKey(g.facts.businessName)) ?? []) if (o !== g) hints.add(`same business as ${o.facts.address}, ${o.facts.city ?? ""} (${reached(o)})`);
    if (!vacant(g.facts.businessName)) {
      const first = (g.facts.businessName ?? "").split(/[/(]/)[0].trim();
      if (first.length >= 4) {
        const same = await prisma.aqProperty.findMany({ where: { businessName: { contains: first, mode: "insensitive" }, NOT: { id: ctx[g.key]?.id ?? "~" } }, select: { address: true, city: true, junkedAt: true, junkReason: true }, take: 3 });
        for (const s of same) hints.add(`the CRM already has "${first}" at ${s.address}, ${s.city ?? ""}${s.junkedAt ? ` (junk: ${s.junkReason ?? ""})` : ""}`);
      }
    }
    const digits = g.phones.map((p) => p.digits).filter((d) => d.length >= 10);
    if (digits.length) {
      const people = await prisma.aqContact.findMany({ where: { OR: digits.flatMap((d) => [{ phone: { contains: d.slice(-7) } }, { secondaryPhone: { contains: d.slice(-7) } }]) }, select: { phone: true, secondaryPhone: true, firstName: true, lastName: true, properties: { select: { property: { select: { id: true, address: true, city: true } } } } }, take: 10 });
      for (const c of people) {
        const own = [c.phone, c.secondaryPhone].map(normalizePhone);
        if (!digits.some((d) => own.includes(d))) continue;
        for (const x of c.properties) if (x.property.id !== ctx[g.key]?.id && normalizeAddrLoose(x.property.address) !== normalizeAddrLoose(g.facts.address)) hints.add(`a number here belongs to ${[c.firstName, c.lastName].filter(Boolean).join(" ")} in the CRM, tied to ${x.property.address}, ${x.property.city ?? ""}`);
      }
    }
    if (hints.size) out[g.key] = [...hints].slice(0, 6);
  }
  return out;
}
const normalizeAddrLoose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A property that needs no judgment: nobody dialed it, nothing tagged, no duplicate signs. */
export function ruleReading(g: PropertyGroup, ctx: CrmContext, hints: string[] | undefined): Reading | null {
  if (g.phones.some(dialed) || tagsOf(g).length || g.phones.some((p) => p.notes.length) || hints?.length) return null;
  if (ctx) return { outcome: ctx.junk ? "junk" : "live", junkReason: ctx.junk ?? undefined, why: `Not dialed in this file; already in the CRM${ctx.junk ? " (in Junk)" : ctx.result ? ` as ${ctx.result}` : ""}, left as it is.`, by: "rule" };
  return { outcome: "live", callResult: "Skipped", why: "Never dialed, no tags, no duplicate found in the file or the CRM: imported as Skipped.", by: "rule" };
}

// ---------- the prompt ----------

const letter = (i: number) => String.fromCharCode(65 + i);

function describe(ref: string, g: PropertyGroup, ctx: CrmContext, hints: string[] | undefined): string {
  const f = g.facts;
  const who = new Map(g.people.map((p, i) => [p.key, letter(i)]));
  const lines: string[] = [];
  lines.push(`### ${ref}: ${f.address}, ${f.city ?? ""} ${f.state ?? ""}${f.parcelId ? ` | parcel ${f.parcelId}` : ""}`);
  lines.push(`Business: ${f.businessName ?? "(none)"}${f.category ? ` (${f.category})` : ""} | Owner entity: ${f.ownerEntity ?? "(none)"} | ${f.assetType ?? ""}${f.acreage ? `, ${f.acreage} ac` : ""}${f.squareFeet ? `, ${f.squareFeet} SF` : ""}`);
  lines.push(`People: ${g.people.length ? g.people.map((p, i) => `${letter(i)}) ${p.name}${p.unconfirmed ? " (unconfirmed name)" : ""} [${p.source}]${p.emails.length ? ` emails ${p.emails.join(", ")}` : ""}`).join("; ") : "(no names in the file)"}`);
  lines.push(`Tags on the property: ${tagsOf(g).map((t) => `[${t}]`).join(" ") || "none"}`);
  lines.push("Numbers:");
  for (const p of g.phones) {
    const owner = p.person ? who.get(p.person) ?? "?" : p.slot.startsWith("Store") ? "business (Store Phone)" : "no name";
    const head = `- ${p.number} (${p.digits}) ${p.slot} → ${owner}${p.lineType ? `, ${p.lineType === "M" ? "mobile" : p.lineType === "L" ? "landline" : p.lineType}` : ""}`;
    if (!dialed(p) && !p.tags.length && !p.notes.length) {
      lines.push(`${head}: not dialed`);
      continue;
    }
    lines.push(`${head}: ${p.disposition ?? "no disposition"}${p.lastCall ? ` at ${p.lastCall.replace("T", " ").slice(0, 16)}` : ""}${p.tags.length ? ` tags ${p.tags.map((t) => `[${t}]`).join(" ")}` : ""}${isBadNumber(p) ? " (code junks this number)" : ""}`);
    for (const n of p.notes) lines.push(`    note ${n.date?.replace("T", " ").slice(0, 16) ?? ""}: ${n.text}`);
    if (p.transcript) lines.push(`    transcript: ${p.transcript.slice(0, 6000)}`);
  }
  lines.push(`Latest call: ${lastCallOf(g)?.replace("T", " ").slice(0, 16) ?? "never dialed"}`);
  lines.push(`In the CRM already: ${ctx ? `yes; ${ctx.junk ? `in Junk (${ctx.junk}); ` : ""}result ${ctx.result ?? "none"}; last call ${ctx.lastCall ?? "none"}; ${ctx.isDeal ? `active deal at ${ctx.dealStage}` : ctx.pipeline ? "on the Deals Pipeline list" : "not on a deal list"}` : "no, new"}`);
  if (hints?.length) lines.push(`Possible duplicate: ${hints.join("; ")}`);
  return lines.join("\n");
}

// Structured output (this model takes no forced tool call). Every field is required and "" / [] / 0 / false mean
// "nothing", since the API caps optional and nullable fields.
const PersonPhone = z.object({ person: z.string().describe("person letter, or 'operator'"), phone: z.string().describe("digits") });
const Out = z.object({
  readings: z.array(
    z.object({
      ref: z.string().describe("the property ref, e.g. P3"),
      outcome: z.enum(["live", "junk", "hold"]).describe("junk: the whole property goes to Junk Properties; hold: Shawn must decide, nothing is written until he answers"),
      callResult: z.enum(["", ...AQ_STAGES]).describe("the call result; empty when the file gives nothing new (e.g. not dialed and already in the CRM)"),
      callBackDate: z.string().describe("yyyy-mm-dd worked out from the note, counted from that call's date; only with Callback, else empty"),
      pipeline: z.boolean().describe("a potential deal: Send to pipeline (Deals Pipeline list)"),
      priority: z.number().int().describe("1 to 5 for the Deals Pipeline list when the call makes it clear, else 0"),
      deal: z.boolean().describe("an active deal on the Deals board"),
      dealStage: z.string().describe("with deal: the stage, else empty"),
      junkReason: z.string().describe("with outcome junk: gas station, too small, car wash, duplicate of [address]..., else empty"),
      question: z.string().describe("with outcome hold: what you saw and your best guess, plain English, one or two sentences; else empty"),
      guess: z.enum(["", "junk", "pipeline", "deal", "live"]).describe("with outcome hold, else empty"),
      why: z.string().describe("one short line for Shawn: what happened on the calls and why you chose this; name the tag or words that decided it"),
      autoNote: z.string().describe("for a real conversation with no tag: a one-line summary starting with '(auto) '; [Message] gives 'Left message'; else empty"),
      callPerson: z.string().describe("letter of the person Shawn actually spoke with, or 'operator' for someone at the business not on the list; empty for the main owner"),
      primary: z.array(PersonPhone).describe("per person: the number Shawn really reached them on (a real two-way conversation or a Correct number tag)"),
      wrong: z.array(z.object({ phone: z.string().describe("digits"), reason: z.enum(["Wrong number", "Bad number"]) })).describe("wrong numbers beyond the ones code already junks (Bad Number disposition, [Wrong Number] tag), e.g. the transcript says wrong person"),
      extraPhones: z.array(PersonPhone).describe("numbers someone gave on a call or Shawn typed in a note"),
      emails: z.array(z.object({ person: z.string(), email: z.string() })).describe("emails Shawn typed in a note or got on a call; they become the Primary Email"),
      operatorName: z.string().describe("only when a call or note names a real person running the business who is not an owner letter (e.g. 'ask for Jeff'); else empty"),
      operatorPhone: z.string().describe("that operator person's own number if given, else empty"),
      operatorEmail: z.string().describe("that operator person's email if given, else empty"),
      ownerRunsBusiness: z.array(z.string()).describe("letters of owners the calls say also run the business"),
      expandingOperator: z.string().describe("letter or 'operator' for the [Expanding Operator] tag, else empty"),
      buyer: z.string().describe("letter or 'operator' for the [Buyer] tag, else empty"),
      propertyNote: z.string().describe("a note for the property itself, e.g. 'Already listed with a broker', else empty"),
      skipTranscripts: z.array(z.string()).describe("digits of numbers whose transcript is only a voicemail greeting, an automated message or no real words"),
    }),
  ),
});

async function system(): Promise<Anthropic.TextBlockParam[]> {
  const [instructions, rules, stages] = await Promise.all([importInstructionsText().then((r) => r.text), loadDataRules("AQ"), getAqDealStages()]);
  const text = `You read Shawn Aziz's Terakotta cold-call exports for the RJL Acquisitions CRM (he buys auto-repair real estate). Code has already folded the file's phone rows into properties, mapped the property facts, sorted each number to its person, and will junk every number with a Bad Number disposition or a [Wrong Number] tag. Your job is the judgment the code cannot do: for each property below, read the tags, notes, transcripts and call times and decide what happened, following Shawn's standing instructions exactly (sections 5 to 8 especially). Think like Shawn, not like a checklist.

Rules of the road:
- Every property gets exactly one reading, keyed by its ref. Never skip one.
- Tags are Shawn's own word and come first; notes next; transcripts after. When tags conflict (Pipeline and Remove, Deal and Remove), read the times and notes; if the later word clearly settles it you may still not pick: set outcome hold with your best guess and a plain question.
- A junk property: outcome junk with the reason from his notes ("doesn't fit" when he gave none). Never also pipeline, deal or callback.
- [Push to HubSpot] means nothing. A property reached only through voicemail or nobody picking up is No answer. [Message] is No answer with a "Left message" autoNote.
- Never dialed: look at the duplicate signs. A clear duplicate of a property Shawn reached is junk "Duplicate of [address]". Already in the CRM: leave callResult empty. No reason found: callResult Skipped. Unsure whether it is a duplicate: live, and say so in why.
- A property already in Junk that this file tags Pipeline, Deal or FU- Call back: hold and ask.
- Deal stages, first is the default: ${stages.join(", ")}.
- Dates: Callback dates are counted from that call's date.
- why is shown to Shawn beside every property; make it specific and short, e.g. "Tagged [FU- Call back]; note says call tomorrow before 4 for Jeff."

SHAWN'S STANDING IMPORT INSTRUCTIONS:
${instructions || "(none saved)"}

DATA RULES (lessons he has taught):
${rules.length ? rules.map((r) => `- ${r}`).join("\n") : "(none)"}`;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

const clean = (v: unknown, n = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const digits = (v: unknown) => (typeof v === "string" ? normalizePhone(v) : "");

/** One batch: describe, ask, map the letters back to people. Returns readings by property key. */
export async function readBatch(groups: PropertyGroup[], ctx: Record<string, CrmContext>, hints: Record<string, string[]>, sys?: Anthropic.TextBlockParam[]): Promise<Record<string, Reading>> {
  const refs = groups.map((g, i) => ({ ref: `P${i + 1}`, g }));
  const body = refs.map(({ ref, g }) => describe(ref, g, ctx[g.key] ?? null, hints[g.key])).join("\n\n");
  const client = new Anthropic();
  const res = await client.messages.parse({ model: READ_MODEL, max_tokens: 16_000, system: sys ?? (await system()), messages: [{ role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}. ${refs.length} properties:\n\n${body}` }], output_config: { format: zodOutputFormat(Out) } });
  const list = (res.parsed_output?.readings ?? []) as unknown as Record<string, unknown>[];
  const out: Record<string, Reading> = {};
  for (const { ref, g } of refs) {
    const r = list.find((x) => String(x.ref).trim().toUpperCase() === ref);
    if (!r) continue;
    const toKey = (v: unknown) => {
      const s = clean(v, 20);
      if (!s) return undefined;
      if (/^operator$/i.test(s)) return "operator";
      const i = s.toUpperCase().charCodeAt(0) - 65;
      return g.people[i]?.key;
    };
    const pairs = (v: unknown, field: "phone" | "email") =>
      (Array.isArray(v) ? v : []).flatMap((x) => {
        const o = x as Record<string, unknown>;
        const person = toKey(o.person);
        const val = field === "phone" ? clean(o.phone, 40) : clean(o.email, 160)?.toLowerCase();
        return person && val ? [{ person, [field]: val } as { person: string; phone: string } & { person: string; email: string }] : [];
      });
    const outcome = (["live", "junk", "hold"] as const).find((o) => o === r.outcome) ?? "hold";
    const callResult = (AQ_STAGES as readonly string[]).includes(String(r.callResult)) ? String(r.callResult) : undefined;
    const opName = clean(r.operatorName, 120);
    out[g.key] = {
      outcome,
      callResult,
      callBackDate: callResult === "Callback" && /^\d{4}-\d{2}-\d{2}$/.test(String(r.callBackDate)) ? String(r.callBackDate) : undefined,
      pipeline: r.pipeline === true || undefined,
      priority: typeof r.priority === "number" && r.priority > 0 ? Math.min(5, Math.max(1, Math.round(r.priority))) : undefined,
      deal: r.deal === true || undefined,
      dealStage: clean(r.dealStage, 60),
      junkReason: clean(r.junkReason, 200),
      question: clean(r.question, 1000),
      guess: (["junk", "pipeline", "deal", "live"] as const).find((x) => x === r.guess),
      why: clean(r.why, 600) ?? "(no reason given)",
      autoNote: clean(r.autoNote, 600),
      callPerson: toKey(r.callPerson),
      primary: pairs(r.primary, "phone").map((p) => ({ person: p.person, phone: digits(p.phone) })),
      wrong: (Array.isArray(r.wrong) ? r.wrong : []).flatMap((x) => {
        const o = x as Record<string, unknown>;
        return digits(o.phone).length >= 7 ? [{ phone: digits(o.phone), reason: o.reason === "Bad number" ? "Bad number" : "Wrong number" }] : [];
      }),
      extraPhones: pairs(r.extraPhones, "phone"),
      emails: pairs(r.emails, "email").map((e) => ({ person: e.person, email: e.email })),
      operatorPerson: opName ? { name: opName, phone: clean(r.operatorPhone, 40), email: clean(r.operatorEmail, 160)?.toLowerCase() } : undefined,
      ownerRunsBusiness: (Array.isArray(r.ownerRunsBusiness) ? r.ownerRunsBusiness : []).map(toKey).filter((x): x is string => Boolean(x)),
      expandingOperator: toKey(r.expandingOperator),
      buyer: toKey(r.buyer),
      propertyNote: clean(r.propertyNote, 600),
      skipTranscripts: (Array.isArray(r.skipTranscripts) ? r.skipTranscripts : []).map(digits).filter((d) => d.length >= 7),
      by: "claude",
    };
  }
  return out;
}

export const readSystem = system;

/** Batches small enough that nothing is ever clipped: at most 8 properties and about 40k characters of calls each. */
export function batchesOf(groups: PropertyGroup[]): PropertyGroup[][] {
  const out: PropertyGroup[][] = [];
  let cur: PropertyGroup[] = [];
  let size = 0;
  for (const g of groups) {
    const n = 600 + g.phones.reduce((a, p) => a + 120 + (p.transcript?.length ?? 0) + p.notes.reduce((b, x) => b + x.text.length, 0), 0);
    if (cur.length && (cur.length >= 8 || size + n > 40_000)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(g);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The reading for a property Claude did not return twice in a row: held for Shawn, never dropped. */
export const fallbackReading = (): Reading => ({ outcome: "hold", guess: "live", question: "The reader could not settle this property. Import it as a live property, or tell me what it should be.", why: "Claude did not return a reading for this property after two tries; held so nothing is lost.", by: "fallback" });
