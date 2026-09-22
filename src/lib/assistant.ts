import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import type { Workspace } from "@/lib/access";
import { SYSTEM as CA_SYSTEM, TOOLS as CA_TOOLS, run as runCa } from "@/lib/ask-crm";
import { IL_SYSTEM, IL_TOOLS, runIl } from "@/lib/ask-israel";
import { AQ_ASSET_TYPES, AQ_ROLES, AQ_STAGES, aqFullName, ensureLlc, mergeAqRoles, parseJsonList, propertyLine, toJsonList } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { IL_ROLES, ilFullName } from "@/lib/israel";
import { ROLES as CA_ROLES } from "@/lib/taxonomy";
import { appendDataRule, loadDataRules } from "@/lib/data-rules";
import { stripDashes } from "@/lib/style";

/**
 * Ask the CRM, all three sides (Sep 18, 2026): one chat over the side's records that also takes files. A person
 * drops a spreadsheet (Shawn's property dumps), the assistant reads it with that side's Data rules, proposes what
 * to add (properties, companies, contacts) and the person clicks Import. When the person corrects a reading or
 * says "remember", the lesson is saved as a Data rule (Settings > Data rules) and every later file is read with it.
 */

export type HistoryMessage = { role: "user" | "assistant"; content: string };
export type Sheet = { name: string; rows: number; csv: string };
export type Attachment = { name: string; rows: number; sheets: Sheet[]; truncated: boolean };

export type CompanyRow = { name: string; roles?: string[]; website?: string; phone?: string; city?: string; state?: string; notes?: string };
export type ContactRow = { firstName?: string; lastName?: string; email?: string; emails?: string[]; phone?: string; secondaryPhone?: string; otherPhones?: string[]; mailingAddress?: string; company?: string; roles?: string[]; title?: string; notes?: string; operatorBrandName?: string; website?: string; operatorEntityName?: string; directoryOperatorName?: string; storePhone?: string; directoryOperatorPhone?: string; operatorTotalLocations?: number; lastCallDate?: string; callResult?: string; callBackAt?: string; callNotes?: string; properties?: string[] };
export type PropertyRow = { address: string; neighborhood?: string; city?: string; state?: string; businessName?: string; assetType?: string; parcelId?: string; ownerEntity?: string; ownerName?: string; primaryPhone?: string; secondaryPhone?: string; otherPhones?: string[]; primaryEmail?: string; emails?: string[]; ownerMailingAddress?: string; operatorEntity?: string; operatorName?: string; operatorPhone?: string; operatorEmail?: string; acreage?: number; squareFeet?: number; yearBuilt?: number; lastSaleDate?: string; lastSalePrice?: number; lastCallDate?: string; callResult?: string; callBackAt?: string; callNotes?: string; dealStage?: string; askingPrice?: number; units?: number; notes?: string; companies?: string[]; contacts?: string[] };
export type Proposal = { summary: string; properties?: PropertyRow[]; companies?: CompanyRow[]; contacts?: ContactRow[] };
export type ImportResult = { created: { properties: number; companies: number; contacts: number }; matched: { properties: number; companies: number; contacts: number }; links: { label: string; href: string }[]; skipped: string[] };
export type TurnResult = { answer: string; lookups: string[]; proposal: Proposal | null; savedRules: string[] };

const MAX_TURNS = 10;
const FILE_CHARS = 90_000; // per file, what the model sees
const clip = (s: unknown, n = 12_000) => {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.length > n ? t.slice(0, n) + "\n…(truncated)" : t;
};
const ci = "insensitive" as const;
const NAMES: Record<Workspace, string> = { CA: "RJL Capital Advisors", IL: "RJL Israel", AQ: "RJL Acquisitions" };

// ---------- files ----------

/** A spreadsheet or CSV as text the model can read: every sheet as CSV, blank rows dropped, clipped per file. */
export function parseSpreadsheet(name: string, buf: Buffer): Attachment {
  const lower = name.toLowerCase();
  const sheets: Sheet[] = [];
  let truncated = false;
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    let text = buf.toString("utf8").replace(/^﻿/, "");
    const rows = text.split(/\r?\n/).filter((l) => l.trim()).length;
    if (text.length > FILE_CHARS) {
      text = text.slice(0, FILE_CHARS);
      truncated = true;
    }
    sheets.push({ name: "Sheet1", rows, csv: text });
  } else {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    let budget = FILE_CHARS;
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      if (!ws) continue;
      let csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false, dateNF: "yyyy-mm-dd" });
      const rows = csv.split(/\r?\n/).filter((l) => l.replace(/,/g, "").trim()).length;
      if (!rows) continue;
      if (csv.length > budget) {
        csv = csv.slice(0, Math.max(0, budget));
        truncated = true;
      }
      budget -= csv.length;
      sheets.push({ name: sn, rows, csv });
      if (budget <= 0) {
        truncated = true;
        break;
      }
    }
  }
  return { name, rows: sheets.reduce((a, s) => a + s.rows, 0), sheets, truncated };
}

/** The text form of an attachment that goes into the conversation. */
export const attachmentText = (a: Attachment) => `[Attached file: ${a.name} (${a.rows} rows${a.truncated ? ", clipped; ask for the rest in a second file" : ""})]\n` + a.sheets.map((s) => `--- sheet "${s.name}" (${s.rows} rows) ---\n${s.csv}`).join("\n");

// ---------- RJL Acquisitions lookups ----------

const AQ_LOOKUPS: Anthropic.Tool[] = [
  { name: "search_properties", description: "Find properties in RJL Acquisitions by address, neighborhood, city, state or a linked company or person.", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
  { name: "search_companies", description: "Find companies (sellers, operators, buyers) in RJL Acquisitions by name or city.", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
  { name: "search_contacts", description: "Find people in RJL Acquisitions by name, email, phone or company.", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
  { name: "call_backs", description: "Properties whose Call Result is Callback, with their dates and the people to call.", input_schema: { type: "object", properties: {} } },
  { name: "pipeline", description: "Every property marked Deal, by pipeline stage.", input_schema: { type: "object", properties: {} } },
];

async function runAq(name: string, input: Record<string, unknown>): Promise<unknown> {
  const q = String(input.q ?? "").trim();
  switch (name) {
    case "search_properties": {
      const rows = await prisma.aqProperty.findMany({
        where: { OR: [{ address: { contains: q, mode: ci } }, { neighborhood: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }, { state: { contains: q, mode: ci } }, { businessName: { contains: q, mode: ci } }, { ownerEntity: { contains: q, mode: ci } }, { ownerName: { contains: q, mode: ci } }, { primaryPhone: { contains: q } }, { parcelId: { contains: q, mode: ci } }, { companies: { some: { company: { name: { contains: q, mode: ci } } } } }, { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: ci } }, { lastName: { contains: q, mode: ci } }] } } } }] },
        take: 25,
        include: { companies: { include: { company: { select: { name: true } } } }, contacts: { include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } } } },
      });
      return rows.map((p) => ({ address: p.address, where: propertyLine(p), businessName: p.businessName, callResult: parseJsonList(p.stages), dealStage: p.dealStage, callBackAt: p.callBackAt?.toISOString().slice(0, 10), followUpAt: p.followUpAt?.toISOString().slice(0, 10), lastCallDate: p.lastCallDate?.toISOString().slice(0, 10), callNotes: p.callNotes, owner: p.ownerEntity, ownerName: p.ownerName, phones: [p.primaryPhone, p.secondaryPhone, p.otherPhones].filter(Boolean).join("; "), emails: [p.primaryEmail, p.emails].filter(Boolean).join("; "), parcelId: p.parcelId, acreage: p.acreage, yearBuilt: p.yearBuilt, lastSale: p.lastSalePrice, lastSaleDate: p.lastSaleDate?.toISOString().slice(0, 10), askingPrice: p.askingPrice, units: p.units, squareFeet: p.squareFeet, assetType: p.assetType, companies: p.companies.map((x) => x.company.name), contacts: p.contacts.map((x) => `${aqFullName(x.contact)}${x.contact.phone ? " " + x.contact.phone : ""}`), notes: p.notes, link: `/acquisitions/properties/${p.id}` }));
    }
    case "search_companies": {
      const rows = await prisma.aqCompany.findMany({ where: { OR: [{ name: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }] }, take: 25, include: { _count: { select: { contacts: true, properties: true } } } });
      return rows.map((c) => ({ name: c.name, roles: parseJsonList(c.roles), city: c.city, state: c.state, website: c.website, phone: c.phone, contacts: c._count.contacts, properties: c._count.properties, link: `/acquisitions/companies/${c.id}` }));
    }
    case "search_contacts": {
      const rows = await prisma.aqContact.findMany({ where: { OR: [{ firstName: { contains: q, mode: ci } }, { lastName: { contains: q, mode: ci } }, { email: { contains: q, mode: ci } }, { phone: { contains: q, mode: ci } }, { company: { name: { contains: q, mode: ci } } }] }, take: 25, include: { company: { select: { name: true } } } });
      return rows.map((c) => ({ name: aqFullName(c), email: c.email, phone: c.phone, roles: parseJsonList(c.roles), company: c.company?.name, link: `/acquisitions/contacts/${c.id}` }));
    }
    case "call_backs": {
      const rows = await prisma.aqProperty.findMany({ where: { stages: { contains: '"Callback"' }, callBackDismissedAt: null }, orderBy: { callBackAt: "asc" }, take: 50, include: { contacts: { include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } } } } });
      return rows.map((p) => ({ address: p.address, where: propertyLine(p), callBackAt: p.callBackAt?.toISOString().slice(0, 10), people: p.contacts.map((x) => `${aqFullName(x.contact)}${x.contact.phone ? " " + x.contact.phone : ""}`), link: `/acquisitions/properties/${p.id}` }));
    }
    case "pipeline": {
      const stages = await getAqDealStages();
      const rows = await prisma.aqProperty.findMany({ where: { stages: { contains: '"Deal"' } }, select: { id: true, address: true, city: true, state: true, dealStage: true, askingPrice: true } });
      return { stages, deals: rows.map((d) => ({ address: d.address, city: d.city, state: d.state, stage: d.dealStage ?? stages[0], askingPrice: d.askingPrice, link: `/acquisitions/properties/${d.id}` })) };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

const AQ_SYSTEM = `You are the RJL Acquisitions CRM assistant. RJL Acquisitions (Shawn Aziz) buys real estate: it tracks properties (address, neighborhood, city and state kept apart; the business there, the owner of record (usually an LLC) and the person behind it with their phones and emails, parcel, acreage, gross SF, year built, last sale; a Call Result of Deal, Callback with a target date, Not interested, No answer or Wrong number, with call notes and a follow-up date), the companies around them (sellers, operators, buyers) and the people at those companies with their phone numbers, plus a Deal Pipeline for every property marked Deal.
Answer questions from the CRM's data using the lookups; never guess. Link every property, company or person you mention the first time as a markdown link using the "link" paths returned, e.g. [123 Main St](/acquisitions/properties/abc).
Write for Shawn and Jonathan: plain, direct, short. Lead with the answer. Short bullet lists for several items. Dates as "Sep 3". Money as $1.2MM or $850,000. No dashes as punctuation (no em dashes, no " - " between clauses); plain sentences. No headings unless the answer has several distinct parts.`;

// ---------- the import and rule tools ----------

const ROW_COMPANY = { type: "object", properties: { name: { type: "string" }, roles: { type: "array", items: { type: "string" } }, website: { type: "string" }, phone: { type: "string" }, city: { type: "string" }, state: { type: "string" }, notes: { type: "string" } }, required: ["name"] };
const ROW_CONTACT = {
  type: "object",
  properties: {
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string" },
    emails: { type: "array", items: { type: "string" }, description: "other emails" },
    phone: { type: "string" },
    secondaryPhone: { type: "string" },
    otherPhones: { type: "array", items: { type: "string" } },
    mailingAddress: { type: "string" },
    company: { type: "string", description: "company name (the owner's LLC, the operator's business), matching a row in companies when there is one" },
    roles: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    notes: { type: "string" },
    operatorBrandName: { type: "string" },
    website: { type: "string" },
    operatorEntityName: { type: "string" },
    directoryOperatorName: { type: "string" },
    storePhone: { type: "string" },
    directoryOperatorPhone: { type: "string" },
    operatorTotalLocations: { type: "integer" },
    lastCallDate: { type: "string", description: "YYYY-MM-DD" },
    callResult: { type: "string", enum: [...AQ_STAGES] },
    callBackAt: { type: "string", description: "YYYY-MM-DD, only with the Callback result" },
    callNotes: { type: "string" },
    properties: { type: "array", items: { type: "string" }, description: "addresses of properties in this import this person is tied to" },
  },
};
const ROW_PROPERTY = {
  type: "object",
  properties: {
    address: { type: "string", description: "street address only" },
    city: { type: "string" },
    state: { type: "string", description: "two letters" },
    neighborhood: { type: "string" },
    businessName: { type: "string", description: "the business operating at the property" },
    assetType: { type: "string", enum: [...AQ_ASSET_TYPES] },
    parcelId: { type: "string" },
    ownerEntity: { type: "string", description: "the owner of record, usually an LLC" },
    ownerName: { type: "string", description: "the person behind the owner" },
    primaryPhone: { type: "string" },
    secondaryPhone: { type: "string" },
    otherPhones: { type: "array", items: { type: "string" } },
    primaryEmail: { type: "string" },
    emails: { type: "array", items: { type: "string" }, description: "other emails, e.g. from public record" },
    ownerMailingAddress: { type: "string" },
    operatorEntity: { type: "string", description: "the business operating at the property, as a company" },
    operatorName: { type: "string", description: "the person running that business" },
    operatorPhone: { type: "string" },
    operatorEmail: { type: "string" },
    acreage: { type: "number" },
    squareFeet: { type: "integer", description: "gross SF" },
    yearBuilt: { type: "integer" },
    lastSaleDate: { type: "string", description: "YYYY-MM-DD" },
    lastSalePrice: { type: "number" },
    lastCallDate: { type: "string", description: "YYYY-MM-DD" },
    callResult: { type: "string", enum: [...AQ_STAGES] },
    callBackAt: { type: "string", description: "YYYY-MM-DD, only with the Callback result" },
    callNotes: { type: "string" },
    dealStage: { type: "string" },
    askingPrice: { type: "number" },
    units: { type: "integer" },
    notes: { type: "string" },
    companies: { type: "array", items: { type: "string" }, description: "company names linked to this property" },
    contacts: { type: "array", items: { type: "string" }, description: "people linked to this property, by email or 'First Last'" },
  },
  required: ["address"],
};

function importTool(ws: Workspace): Anthropic.Tool {
  const props: Record<string, unknown> = { summary: { type: "string", description: "one or two plain sentences on what the file held and how it was read" }, companies: { type: "array", items: ROW_COMPANY }, contacts: { type: "array", items: ROW_CONTACT } };
  if (ws === "AQ") props.properties = { type: "array", items: ROW_PROPERTY };
  return {
    name: "propose_import",
    description: `Propose records to add to ${NAMES[ws]} from an attached file or from what the user wrote. The user sees the rows and clicks Import; nothing is written until then. Include every usable row. Leave a field out rather than inventing it. Call it once per file with all the rows.`,
    input_schema: { type: "object", properties: props, required: ["summary"] },
  };
}

const SAVE_RULE: Anthropic.Tool = {
  name: "save_rule",
  description: "Save one Data rule for reading this side's files, when the user teaches you something about their files or corrects a reading (\"the Owner column is the seller\", \"skip rows marked DNC\", \"remember: prices are in thousands\"). One short plain sentence, general enough to apply to the next file. Saved rules are read before every file.",
  input_schema: { type: "object", properties: { rule: { type: "string" } }, required: ["rule"] },
};

function importGuide(ws: Workspace, rules: string[]): string {
  const fields =
    ws === "AQ"
      ? `Properties (the real estate only): address (street only), city, state (2 letters), county, neighborhood, businessName (the business operating there), assetType (${AQ_ASSET_TYPES.join(", ")}), parcelId, acreage, squareFeet (gross SF), yearBuilt, lastSaleDate (YYYY-MM-DD), lastSalePrice, callResult "Deal" when the row marks it a deal, dealStage (only with Deal), askingPrice, units, notes, companies (names), contacts (email or "First Last" of contact rows to link). PEOPLE ARE CONTACT ROWS: the owner of the real estate is a contact with roles ["Owner"] and company = the owner entity (usually an LLC); the operator of the business there is a contact with roles ["Operator"], company = the business, plus operatorBrandName, website, operatorEntityName, directoryOperatorName, storePhone, directoryOperatorPhone, operatorTotalLocations when the sheet has them. Every contact carries its own phone, secondaryPhone, otherPhones, email, emails, mailingAddress, and the call: lastCallDate, callResult (${AQ_STAGES.join(", ")}), callBackAt, callNotes. Put the property addresses the person is tied to in the contact's properties list so they link. Make a company row for each owner entity and each operator business.`
      : ws === "IL"
        ? `Companies: name, roles (${IL_ROLES.join(", ")}), website, phone, city, notes. Contacts: firstName, lastName, email, phone, company (name), roles (${IL_ROLES.join(", ")}), notes.`
        : `Companies: name, roles (${CA_ROLES.join(", ")}), website, phone, city, state, notes. Contacts: firstName, lastName, email, phone, company (name), roles (${CA_ROLES.join(", ")}), title, notes.`;
  return `
FILES. When a file is attached, read it with the Data rules below, work out what each column means from its header and its values, and call propose_import once with every usable row. Then tell the user in a few lines what the file held, how you read the columns, and anything you were unsure about (a column you skipped, rows with no address). Do not list every row in text; the user sees the rows in the proposal. If the file cannot be read as records, say what you see and ask what they want done with it. If the user asks a question about the file rather than to load it, answer the question.
Fields you can fill: ${fields}
Never invent a value; leave the field out. Phone numbers as written. Do not fill a field from a guess about a name.

TEACHING. When the user tells you how their files work, or corrects how you read one ("that column is the neighborhood, not the city", "remember, DNC means Not interested", "from now on skip the first sheet"), call save_rule with one short general sentence, then confirm in one line. Apply the rule at once to the file in hand and call propose_import again with the corrected rows. Never save a rule the user did not state or imply.

DATA RULES for ${NAMES[ws]} (what the team has taught so far; follow every one):
${rules.length ? rules.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(none yet)"}`;
}

// ---------- the turn ----------

export async function assistantTurn(ws: Workspace, history: HistoryMessage[], userName: string): Promise<TurnResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { answer: "Claude is not configured on this server.", lookups: [], proposal: null, savedRules: [] };
  const rules = await loadDataRules(ws);
  const base = ws === "IL" ? IL_SYSTEM : ws === "AQ" ? AQ_SYSTEM : CA_SYSTEM;
  const lookups = ws === "IL" ? IL_TOOLS : ws === "AQ" ? AQ_LOOKUPS : CA_TOOLS;
  const exec = ws === "IL" ? runIl : ws === "AQ" ? runAq : runCa;
  const tools: Anthropic.Tool[] = [...lookups, importTool(ws), SAVE_RULE];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const system = `${base}\n${importGuide(ws, rules)}\nToday is ${today}. You are talking with ${userName}.`;
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = history.slice(-14).map((m) => ({ role: m.role, content: m.content }));
  const used: string[] = [];
  const savedRules: string[] = [];
  let proposal: Proposal | null = null;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({ model: "claude-opus-5", max_tokens: 16_000, system, tools, messages });
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !toolUses.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: stripDashes(text) || (proposal ? "Here is what I read from the file." : "I could not put an answer together. Try asking another way."), lookups: used, proposal, savedRules };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      let out: unknown;
      try {
        if (tu.name === "propose_import") {
          proposal = cleanProposal(ws, input as unknown as Proposal, await getAqDealStages());
          const n = (proposal.properties?.length ?? 0) + (proposal.companies?.length ?? 0) + (proposal.contacts?.length ?? 0);
          used.push(`propose_import(${n} rows)`);
          out = { ok: true, rows: n, note: "The user now sees these rows with an Import button. Summarize briefly; do not repeat the rows." };
        } else if (tu.name === "save_rule") {
          const r = await appendDataRule(ws, String(input.rule ?? ""));
          if (r.added) savedRules.push(String(input.rule).trim());
          used.push(`save_rule(${JSON.stringify(String(input.rule ?? "").slice(0, 80))})`);
          out = { ok: true, added: r.added, rules: r.rules.length };
        } else {
          used.push(`${tu.name}(${Object.entries(input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})`);
          out = await exec(tu.name, input);
        }
      } catch (e) {
        out = { error: String(e instanceof Error ? e.message : e).slice(0, 300) };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: clip(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "That took more steps than I allow in one go. Ask a narrower question or send a smaller file.", lookups: used, proposal, savedRules };
}

const str = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) && v.trim() ? n : undefined;
  }
  return undefined;
};
const isoDay = (v: unknown) => {
  const t = str(v, 30);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};
const list = (v: unknown, allowed?: readonly string[]) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter((x): x is string => Boolean(x)).filter((x) => !allowed || allowed.includes(x)) : undefined);

/** Only fields we know, only values that are there. */
function cleanProposal(ws: Workspace, p: Proposal, dealStages: string[]): Proposal {
  const roles = ws === "AQ" ? AQ_ROLES : ws === "IL" ? IL_ROLES : CA_ROLES;
  const out: Proposal = { summary: str(p.summary, 600) ?? "" };
  const companies = (Array.isArray(p.companies) ? p.companies : []).flatMap((c): CompanyRow[] => {
    const name = str(c.name, 160);
    return name ? [{ name, roles: list(c.roles, roles), website: str(c.website), phone: str(c.phone, 60), city: str(c.city, 80), state: str(c.state, 40), notes: str(c.notes, 1000) }] : [];
  });
  const contacts = (Array.isArray(p.contacts) ? p.contacts : [])
    .map((c) => ({
      firstName: str(c.firstName, 80),
      lastName: str(c.lastName, 80),
      email: str(c.email, 160)?.toLowerCase(),
      emails: list(c.emails)?.map((e) => e.toLowerCase()),
      phone: str(c.phone, 60),
      secondaryPhone: str(c.secondaryPhone, 60),
      otherPhones: list(c.otherPhones),
      mailingAddress: str(c.mailingAddress, 240),
      company: str(c.company, 160),
      roles: list(c.roles, roles),
      title: str(c.title, 120),
      notes: str(c.notes, 1000),
      operatorBrandName: str(c.operatorBrandName, 160),
      website: str(c.website, 200),
      operatorEntityName: str(c.operatorEntityName, 160),
      directoryOperatorName: str(c.directoryOperatorName, 160),
      storePhone: str(c.storePhone, 60),
      directoryOperatorPhone: str(c.directoryOperatorPhone, 60),
      operatorTotalLocations: num(c.operatorTotalLocations) != null ? Math.round(num(c.operatorTotalLocations)!) : undefined,
      lastCallDate: isoDay(c.lastCallDate),
      callResult: (AQ_STAGES as readonly string[]).includes(str(c.callResult, 40) ?? "") ? str(c.callResult, 40) : undefined,
      callBackAt: isoDay(c.callBackAt),
      callNotes: str(c.callNotes, 2000),
      properties: list(c.properties),
    }))
    .filter((c) => c.firstName || c.lastName || c.email);
  if (companies.length) out.companies = companies;
  if (contacts.length) out.contacts = contacts;
  if (ws === "AQ") {
    const properties = (Array.isArray(p.properties) ? p.properties : []).flatMap((r): PropertyRow[] => {
        const stages = list([r.callResult], AQ_STAGES) ?? [];
        const cb = str(r.callBackAt, 20);
        const address = str(r.address, 200);
        if (!address) return [];
        return [{
          address,
          neighborhood: str(r.neighborhood, 120),
          city: str(r.city, 120),
          state: str(r.state, 2)?.toUpperCase(),
          businessName: str(r.businessName, 160),
          assetType: (AQ_ASSET_TYPES as readonly string[]).includes(str(r.assetType, 80) ?? "") ? str(r.assetType, 80) : undefined,
          parcelId: str(r.parcelId, 80),
          ownerEntity: ensureLlc(str(r.ownerEntity, 160)) ?? undefined,
          ownerName: str(r.ownerName, 160),
          primaryPhone: str(r.primaryPhone, 40),
          secondaryPhone: str(r.secondaryPhone, 40),
          otherPhones: list(r.otherPhones),
          primaryEmail: str(r.primaryEmail, 160)?.toLowerCase(),
          emails: list(r.emails)?.map((e) => e.toLowerCase()),
          ownerMailingAddress: str(r.ownerMailingAddress, 240),
          operatorEntity: str(r.operatorEntity, 160),
          operatorName: str(r.operatorName, 160),
          operatorPhone: str(r.operatorPhone, 40),
          operatorEmail: str(r.operatorEmail, 160)?.toLowerCase(),
          acreage: num(r.acreage),
          yearBuilt: num(r.yearBuilt) != null ? Math.round(num(r.yearBuilt)!) : undefined,
          lastSaleDate: isoDay(r.lastSaleDate),
          lastSalePrice: num(r.lastSalePrice),
          lastCallDate: isoDay(r.lastCallDate),
          callResult: stages[0],
          callBackAt: stages.includes("Callback") && cb && /^\d{4}-\d{2}-\d{2}$/.test(cb) ? cb : undefined,
          callNotes: str(r.callNotes, 2000),
          dealStage: stages.includes("Deal") ? (dealStages.includes(str(r.dealStage, 80) ?? "") ? str(r.dealStage, 80) : dealStages[0]) : undefined,
          askingPrice: num(r.askingPrice),
          units: num(r.units) != null ? Math.round(num(r.units)!) : undefined,
          squareFeet: num(r.squareFeet) != null ? Math.round(num(r.squareFeet)!) : undefined,
          notes: str(r.notes, 2000),
          companies: list(r.companies),
          contacts: list(r.contacts),
        }];
      });
    if (properties.length) out.properties = properties;
  }
  return out;
}

// ---------- Import ----------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const domainOfUrl = (w: string | undefined) => (w ? w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() || null : null);

/** Write a proposal into the side. Existing rows are matched (company by name, person by email or name at the company, property by address and city) and only their empty fields are filled; new ones are created. */
export async function runImport(ws: Workspace, p: Proposal): Promise<ImportResult> {
  const result: ImportResult = { created: { properties: 0, companies: 0, contacts: 0 }, matched: { properties: 0, companies: 0, contacts: 0 }, links: [], skipped: [] };
  const link = (label: string, href: string) => {
    if (result.links.length < 40) result.links.push({ label, href });
  };
  const companyIds = new Map<string, string>(); // norm(name) → id
  const contactIds = new Map<string, string>(); // email or norm(name) → id
  const pendingLinks: { contactId: string; address: string }[] = [];

  if (ws === "AQ") {
    // companies named on property rows count too
    const names = new Map<string, CompanyRow>();
    for (const c of p.companies ?? []) names.set(norm(c.name), c);
    for (const r of p.properties ?? []) for (const n of r.companies ?? []) if (!names.has(norm(n))) names.set(norm(n), { name: n });
    for (const c of names.values()) {
      const found = await prisma.aqCompany.findFirst({ where: { name: { equals: c.name, mode: ci } } });
      if (found) {
        await prisma.aqCompany.update({ where: { id: found.id }, data: { roles: c.roles?.length ? toJsonList([...parseJsonList(found.roles), ...c.roles]) : undefined, website: found.website ?? c.website, domain: found.domain ?? domainOfUrl(c.website), phone: found.phone ?? c.phone, city: found.city ?? c.city, state: found.state ?? c.state, notes: found.notes ?? c.notes } });
        companyIds.set(norm(c.name), found.id);
        result.matched.companies++;
      } else {
        const made = await prisma.aqCompany.create({ data: { name: c.name, roles: toJsonList(c.roles ?? []), website: c.website, domain: domainOfUrl(c.website), phone: c.phone, city: c.city, state: c.state, notes: c.notes } });
        companyIds.set(norm(c.name), made.id);
        result.created.companies++;
        link(c.name, `/acquisitions/companies/${made.id}`);
      }
    }
    for (const c of p.contacts ?? []) {
      const companyId = c.company ? companyIds.get(norm(c.company)) ?? null : null;
      const company = companyId ? await prisma.aqCompany.findUnique({ where: { id: companyId }, select: { roles: true } }) : null;
      const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
      const found = (c.email ? await prisma.aqContact.findFirst({ where: { email: { equals: c.email, mode: ci } } }) : null) ?? (fullName && (c.firstName || c.lastName) ? await prisma.aqContact.findFirst({ where: { firstName: { equals: c.firstName ?? "", mode: ci }, lastName: { equals: c.lastName ?? "", mode: ci }, ...(companyId ? { companyId } : {}) } }) : null);
      const roles = mergeAqRoles(toJsonList(c.roles ?? []), company?.roles);
      const callBackAt = c.callResult === "Callback" && c.callBackAt ? new Date(`${c.callBackAt}T12:00:00`) : null;
      const extra = {
        emails: c.emails?.length ? c.emails.join("\n") : undefined,
        secondaryPhone: c.secondaryPhone,
        otherPhones: c.otherPhones?.length ? c.otherPhones.join("\n") : undefined,
        mailingAddress: c.mailingAddress,
        operatorBrandName: c.operatorBrandName,
        website: c.website,
        operatorEntityName: c.operatorEntityName,
        directoryOperatorName: c.directoryOperatorName,
        storePhone: c.storePhone,
        directoryOperatorPhone: c.directoryOperatorPhone,
        operatorTotalLocations: c.operatorTotalLocations,
        lastCallDate: c.lastCallDate ? new Date(`${c.lastCallDate}T12:00:00`) : c.callResult ? new Date() : undefined,
        callResult: c.callResult,
        callBackAt: callBackAt ?? undefined,
        followUpAt: callBackAt ?? undefined,
      };
      let contactId: string;
      if (found) {
        const fill = Object.fromEntries(Object.entries(extra).filter(([k, v]) => v !== undefined && (found as Record<string, unknown>)[k] == null || k === "callResult" || k === "lastCallDate" || k === "callBackAt" || k === "followUpAt").filter(([, v]) => v !== undefined));
        await prisma.aqContact.update({ where: { id: found.id }, data: { email: found.email ?? c.email, phone: found.phone ?? c.phone, companyId: found.companyId ?? companyId, roles: toJsonList([...parseJsonList(found.roles), ...parseJsonList(roles)]), notes: found.notes ?? c.notes, ...fill } });
        contactId = found.id;
        result.matched.contacts++;
      } else {
        const made = await prisma.aqContact.create({ data: { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, companyId, roles, notes: c.notes, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) } });
        contactId = made.id;
        result.created.contacts++;
        link(fullName || c.email || "Contact", `/acquisitions/contacts/${made.id}`);
      }
      if (c.email) contactIds.set(c.email.toLowerCase(), contactId);
      if (fullName) contactIds.set(norm(fullName), contactId);
      if (c.callNotes) await prisma.aqNote.create({ data: { contactId, body: c.callNotes } });
      for (const addr of c.properties ?? []) pendingLinks.push({ contactId, address: addr });
    }
    const dealStages = await getAqDealStages();
    const propertyIds = new Map<string, string>(); // norm(address) → id
    for (const r of p.properties ?? []) {
      const found = await prisma.aqProperty.findFirst({ where: { address: { equals: r.address, mode: ci }, ...(r.city ? { city: { equals: r.city, mode: ci } } : {}) } });
      const stages = r.callResult ? [r.callResult] : [];
      const callBackAt = r.callBackAt ? new Date(`${r.callBackAt}T12:00:00`) : null;
      const day = (v: string | undefined) => (v ? new Date(`${v}T12:00:00`) : null);
      const extra = {
        businessName: r.businessName,
        assetType: r.assetType,
        parcelId: r.parcelId,
        ownerEntity: r.ownerEntity,
        ownerName: r.ownerName,
        primaryPhone: r.primaryPhone,
        secondaryPhone: r.secondaryPhone,
        otherPhones: r.otherPhones?.length ? r.otherPhones.join("\n") : undefined,
        primaryEmail: r.primaryEmail,
        emails: r.emails?.length ? r.emails.join("\n") : undefined,
        ownerMailingAddress: r.ownerMailingAddress,
        operatorEntity: r.operatorEntity,
        operatorName: r.operatorName,
        operatorPhone: r.operatorPhone,
        operatorEmail: r.operatorEmail,
        acreage: r.acreage,
        yearBuilt: r.yearBuilt,
        lastSaleDate: day(r.lastSaleDate),
        lastSalePrice: r.lastSalePrice,
        lastCallDate: day(r.lastCallDate),
        followUpAt: callBackAt,
      };
      let id: string;
      if (found) {
        const merged = (AQ_STAGES as readonly string[]).filter((s) => parseJsonList(found.stages).includes(s) || stages.includes(s));
        await prisma.aqProperty.update({
          where: { id: found.id },
          data: {
            neighborhood: found.neighborhood ?? r.neighborhood,
            city: found.city ?? r.city,
            state: found.state ?? r.state,
            stages: stages.length ? JSON.stringify(merged) : undefined,
            businessName: found.businessName ?? extra.businessName,
            parcelId: found.parcelId ?? extra.parcelId,
            ownerEntity: found.ownerEntity ?? extra.ownerEntity,
            ownerName: found.ownerName ?? extra.ownerName,
            primaryPhone: found.primaryPhone ?? extra.primaryPhone,
            secondaryPhone: found.secondaryPhone ?? extra.secondaryPhone,
            otherPhones: found.otherPhones ?? extra.otherPhones,
            primaryEmail: found.primaryEmail ?? extra.primaryEmail,
            emails: found.emails ?? extra.emails,
            ownerMailingAddress: found.ownerMailingAddress ?? extra.ownerMailingAddress,
            operatorEntity: found.operatorEntity ?? extra.operatorEntity,
            operatorName: found.operatorName ?? extra.operatorName,
            operatorPhone: found.operatorPhone ?? extra.operatorPhone,
            operatorEmail: found.operatorEmail ?? extra.operatorEmail,
            acreage: found.acreage ?? extra.acreage,
            yearBuilt: found.yearBuilt ?? extra.yearBuilt,
            lastSaleDate: found.lastSaleDate ?? extra.lastSaleDate,
            lastSalePrice: found.lastSalePrice ?? extra.lastSalePrice,
            lastCallDate: extra.lastCallDate ?? found.lastCallDate,
            followUpAt: callBackAt ?? found.followUpAt,
            callBackAt: callBackAt ?? found.callBackAt,
            ...(callBackAt ? { callBackDismissedAt: null } : {}),
            dealStage: merged.includes("Deal") ? found.dealStage ?? r.dealStage ?? dealStages[0] : null,
            askingPrice: found.askingPrice ?? r.askingPrice,
            units: found.units ?? r.units,
            squareFeet: found.squareFeet ?? r.squareFeet,
            assetType: found.assetType ?? r.assetType,
            notes: found.notes ? (r.notes && !found.notes.includes(r.notes) ? `${found.notes}\n${r.notes}` : found.notes) : r.notes,
          },
        });
        id = found.id;
        result.matched.properties++;
      } else {
        const made = await prisma.aqProperty.create({ data: { address: r.address, neighborhood: r.neighborhood, city: r.city, state: r.state, stages: JSON.stringify(stages), callBackAt, dealStage: stages.includes("Deal") ? r.dealStage ?? dealStages[0] : null, askingPrice: r.askingPrice, units: r.units, squareFeet: r.squareFeet, notes: r.notes, ...extra } });
        id = made.id;
        result.created.properties++;
        link(r.address, `/acquisitions/properties/${made.id}`);
      }
      if (r.callNotes) await prisma.aqNote.create({ data: { propertyId: id, body: r.callNotes } });
      for (const n of r.companies ?? []) {
        const companyId = companyIds.get(norm(n));
        if (companyId) await prisma.aqPropertyCompany.upsert({ where: { propertyId_companyId: { propertyId: id, companyId } }, create: { propertyId: id, companyId }, update: {} });
      }
      for (const n of r.contacts ?? []) {
        const contactId = contactIds.get(n.toLowerCase()) ?? contactIds.get(norm(n));
        if (contactId) await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId: id, contactId } }, create: { propertyId: id, contactId }, update: {} });
        else result.skipped.push(`${r.address}: no contact called ${n} in this import`);
      }
      propertyIds.set(norm(r.address), id);
    }
    for (const l of pendingLinks) {
      const propertyId = propertyIds.get(norm(l.address)) ?? (await prisma.aqProperty.findFirst({ where: { address: { equals: l.address, mode: ci } }, select: { id: true } }))?.id;
      if (propertyId) await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId, contactId: l.contactId } }, create: { propertyId, contactId: l.contactId }, update: {} });
      else result.skipped.push(`No property at ${l.address} to tie the contact to`);
    }
    return result;
  }

  if (ws === "IL") {
    for (const c of p.companies ?? []) {
      const found = await prisma.ilCompany.findFirst({ where: { name: { equals: c.name, mode: ci } } });
      if (found) {
        await prisma.ilCompany.update({ where: { id: found.id }, data: { roles: c.roles?.length ? toJsonList([...parseJsonList(found.roles), ...c.roles]) : undefined, website: found.website ?? c.website, domain: found.domain ?? domainOfUrl(c.website), phone: found.phone ?? c.phone, city: found.city ?? c.city, notes: found.notes ?? c.notes } });
        companyIds.set(norm(c.name), found.id);
        result.matched.companies++;
      } else {
        const made = await prisma.ilCompany.create({ data: { name: c.name, roles: toJsonList(c.roles ?? []), website: c.website, domain: domainOfUrl(c.website), phone: c.phone, city: c.city, notes: c.notes } });
        companyIds.set(norm(c.name), made.id);
        result.created.companies++;
        link(c.name, `/israel/companies/${made.id}`);
      }
    }
    for (const c of p.contacts ?? []) {
      const companyId = c.company ? companyIds.get(norm(c.company)) ?? (await prisma.ilCompany.findFirst({ where: { name: { equals: c.company, mode: ci } }, select: { id: true } }))?.id ?? null : null;
      const found = (c.email ? await prisma.ilContact.findFirst({ where: { email: { equals: c.email, mode: ci } } }) : null) ?? (c.firstName || c.lastName ? await prisma.ilContact.findFirst({ where: { firstName: { equals: c.firstName ?? "", mode: ci }, lastName: { equals: c.lastName ?? "", mode: ci }, ...(companyId ? { companyId } : {}) } }) : null);
      if (found) {
        await prisma.ilContact.update({ where: { id: found.id }, data: { email: found.email ?? c.email, phone: found.phone ?? c.phone, companyId: found.companyId ?? companyId, roles: c.roles?.length ? toJsonList([...parseJsonList(found.roles), ...c.roles]) : undefined, notes: found.notes ?? c.notes } });
        result.matched.contacts++;
      } else {
        const made = await prisma.ilContact.create({ data: { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, companyId, roles: toJsonList(c.roles ?? []), notes: c.notes } });
        result.created.contacts++;
        link(ilFullName(made) || c.email || "Contact", `/israel/contacts/${made.id}`);
      }
    }
    return result;
  }

  // RJL Capital Advisors
  for (const c of p.companies ?? []) {
    const domain = domainOfUrl(c.website);
    const found = (await prisma.company.findFirst({ where: { name: { equals: c.name, mode: ci } } })) ?? (domain ? await prisma.company.findFirst({ where: { domain: { equals: domain, mode: ci } } }) : null);
    if (found) {
      await prisma.company.update({ where: { id: found.id }, data: { roles: c.roles?.length ? toJsonList([...parseJsonList(found.roles), ...c.roles]) : undefined, website: found.website ?? c.website, domain: found.domain ?? domain, phone: found.phone ?? c.phone, city: found.city ?? c.city, state: found.state ?? c.state, notes: found.notes ?? c.notes } });
      companyIds.set(norm(c.name), found.id);
      result.matched.companies++;
    } else {
      const made = await prisma.company.create({ data: { name: c.name, roles: toJsonList(c.roles ?? []), website: c.website, domain, phone: c.phone, city: c.city, state: c.state, notes: c.notes } });
      companyIds.set(norm(c.name), made.id);
      result.created.companies++;
      link(c.name, `/companies/${made.id}`);
    }
  }
  for (const c of p.contacts ?? []) {
    const companyId = c.company ? companyIds.get(norm(c.company)) ?? (await prisma.company.findFirst({ where: { name: { equals: c.company, mode: ci } }, select: { id: true } }))?.id ?? null : null;
    const found = (c.email ? await prisma.contact.findFirst({ where: { email: { equals: c.email, mode: ci } } }) : null) ?? (c.firstName || c.lastName ? await prisma.contact.findFirst({ where: { firstName: { equals: c.firstName ?? "", mode: ci }, lastName: { equals: c.lastName ?? "", mode: ci }, ...(companyId ? { companyId } : {}) } }) : null);
    if (found) {
      await prisma.contact.update({ where: { id: found.id }, data: { email: found.email ?? c.email, phone: found.phone ?? c.phone, title: found.title ?? c.title, companyId: found.companyId ?? companyId, roles: c.roles?.length ? toJsonList([...parseJsonList(found.roles), ...c.roles]) : undefined, notes: found.notes ?? c.notes } });
      result.matched.contacts++;
    } else {
      const made = await prisma.contact.create({ data: { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, title: c.title, companyId, roles: toJsonList(c.roles ?? []), notes: c.notes } });
      result.created.contacts++;
      link([c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact", `/contacts/${made.id}`);
    }
  }
  return result;
}
