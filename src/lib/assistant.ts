import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import type { Workspace } from "@/lib/access";
import { SYSTEM as CA_SYSTEM, TOOLS as CA_TOOLS, run as runCa } from "@/lib/ask-crm";
import { IL_SYSTEM, IL_TOOLS, runIl } from "@/lib/ask-israel";
import { AQ_ASSET_TYPES, AQ_JUNK_PHONE_REASONS, AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, aqFullName, parseJsonList, propertyLine, toJsonList } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { cleanAqProposal, resolvePendingImport, runAqImport, waitingOnShawn, type CompanyRow, type ContactRow, type ImportResult, type Proposal, type PropertyRow, type ResolveAction } from "@/lib/aq-import";
import { importInstructionsText, updateImportInstructions } from "@/lib/aq-import-instructions";
import { IL_ROLES, ilFullName } from "@/lib/israel";
import { ROLES as CA_ROLES } from "@/lib/taxonomy";
import { appendDataRule, loadDataRules } from "@/lib/data-rules";
import { stripDashes } from "@/lib/style";

/**
 * Ask the CRM, all three sides (Sep 18, 2026): one chat over the side's records that also takes files. A person
 * drops a spreadsheet (Shawn's call-list exports), the assistant reads it with that side's Data rules and standing
 * Import instructions, proposes what to write (properties, companies, contacts, dated notes and transcripts, pipeline
 * placements, junk) and the person clicks Import. When the person corrects a reading or says "remember", the lesson
 * is saved as a Data rule (Settings > Data rules); directions meant for every file are saved as Import instructions
 * (Settings > Import instructions, Acquisitions). The Acquisitions writer itself is in aq-import.ts.
 */

/** A turn's content: text, or text blocks (a dropped file is its own block, marked for prompt caching so later turns reread it at a tenth of the price; Oct 7, 2026). */
export type HistoryMessage = { role: "user" | "assistant"; content: string | Anthropic.TextBlockParam[] };
export type Sheet = { name: string; rows: number; csv: string };
export type Attachment = { name: string; rows: number; sheets: Sheet[]; truncated: boolean };
export type { CompanyRow, ContactRow, ImportResult, Proposal, PropertyRow };
export type TurnResult = { answer: string; lookups: string[]; proposal: Proposal | null; savedRules: string[] };

const MAX_TURNS = 10;
const FILE_CHARS = 350_000; // per file, what the model sees (a 793-row Terakotta export is well over 90k characters, Oct 5, 2026)
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
  { name: "search_properties", description: "Find properties in RJL Acquisitions by address, parcel, neighborhood, city, state, business, category, source list or a linked company or person. Junk properties are included and flagged junk with the reason.", input_schema: { type: "object", properties: { q: { type: "string" }, junkOnly: { type: "boolean", description: "only the properties in Junk Properties" } }, required: ["q"] } },
  { name: "search_companies", description: "Find companies (owners' entities, operators, buyers) in RJL Acquisitions by name or city.", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
  { name: "search_contacts", description: "Find people in RJL Acquisitions by name, email, phone or company: their roles, numbers, call result, pipeline, and the properties they are tied to.", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
  { name: "call_backs", description: "The dashboard's Call Me Back window: people whose Call Result is Callback, with the dates and numbers.", input_schema: { type: "object", properties: {} } },
  { name: "pipeline", description: "The deal lists: active deals on the Deals board by stage (Deal ticked), and potential deals on the Deals Pipeline list (sent to pipeline) with priorities.", input_schema: { type: "object", properties: {} } },
  { name: "waiting_on_shawn", description: "The Waiting on Shawn list: properties an import held back for Shawn to decide (conflicting tags, an unclear duplicate, a junk property an export wants back), numbered oldest first, each with the question and the best guess. Nothing of them is written until he answers.", input_schema: { type: "object", properties: {} } },
  { name: "junk_phones", description: "Numbers on the Junk Phone Numbers list (never written onto a contact), by number, person, reason or source file.", input_schema: { type: "object", properties: { q: { type: "string" } } } },
];

async function runAq(name: string, input: Record<string, unknown>): Promise<unknown> {
  const q = String(input.q ?? "").trim();
  const d10 = (d: Date | null | undefined) => d?.toISOString().slice(0, 10);
  switch (name) {
    case "search_properties": {
      const rows = await prisma.aqProperty.findMany({
        where: {
          ...(input.junkOnly ? { junkedAt: { not: null } } : {}),
          OR: [{ address: { contains: q, mode: ci } }, { parcelId: { contains: q, mode: ci } }, { neighborhood: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }, { state: { contains: q, mode: ci } }, { county: { contains: q, mode: ci } }, { businessName: { contains: q, mode: ci } }, { category: { contains: q, mode: ci } }, { sourceList: { contains: q, mode: ci } }, { ownerEntity: { contains: q, mode: ci } }, { ownerName: { contains: q, mode: ci } }, { primaryPhone: { contains: q } }, { companies: { some: { company: { name: { contains: q, mode: ci } } } } }, { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: ci } }, { lastName: { contains: q, mode: ci } }, { phone: { contains: q } }] } } } }],
        },
        take: 25,
        include: { companies: { include: { company: { select: { name: true } } } }, contacts: { include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true, roles: true, callResult: true } } } }, aqNotes: { orderBy: { createdAt: "desc" }, take: 3, select: { body: true, createdAt: true } } },
      });
      return rows.map((p) => ({
        address: p.address, where: propertyLine(p), county: p.county, parcelId: p.parcelId, businessName: p.businessName, category: p.category, assetType: p.assetType, zoning: p.zoning,
        junk: p.junkedAt ? `Junk: ${p.junkReason ?? "no reason given"} (${d10(p.junkedAt)}${p.junkSource ? `, from ${p.junkSource}` : ""})` : null,
        callResult: parseJsonList(p.stages)[0] ?? null, activeDeal: parseJsonList(p.stages).includes("Deal") ? `on the Deals board, stage ${p.dealStage}` : null, potentialDeal: p.pipelineAt ? `on the Deals Pipeline list since ${d10(p.pipelineAt)}${p.pipelinePriority ? `, priority ${p.pipelinePriority}` : ""}` : null,
        callBackAt: d10(p.callBackAt), followUpAt: d10(p.followUpAt), lastCallDate: d10(p.lastCallDate), callNotes: p.callNotes,
        owner: p.ownerEntity, ownerName: p.ownerName, phones: [p.primaryPhone, p.secondaryPhone, p.otherPhones].filter(Boolean).join("; "), emails: [p.primaryEmail, p.emails].filter(Boolean).join("; "),
        acreage: p.acreage, squareFeet: p.squareFeet, yearBuilt: p.yearBuilt, units: p.units, lastSale: p.lastSalePrice, lastSaleDate: d10(p.lastSaleDate), askingPrice: p.askingPrice, assessedValue: p.assessedValue, googleRating: p.googleRating, reviews: p.reviewCount, reportLink: p.reportUrl, sourceList: p.sourceList,
        companies: p.companies.map((x) => x.company.name), people: p.contacts.map((x) => `${aqFullName(x.contact)} (${parseJsonList(x.contact.roles).join("/") || "no role"}${x.contact.phone ? ", " + x.contact.phone : ""}${x.contact.callResult ? ", " + x.contact.callResult : ""})`),
        recentNotes: p.aqNotes.map((n) => `${d10(n.createdAt)}: ${n.body.slice(0, 160)}`), notes: p.notes, link: `/acquisitions/properties/${p.id}`,
      }));
    }
    case "search_companies": {
      const rows = await prisma.aqCompany.findMany({ where: { OR: [{ name: { contains: q, mode: ci } }, { city: { contains: q, mode: ci } }] }, take: 25, include: { _count: { select: { contacts: true, properties: true } } } });
      return rows.map((c) => ({ name: c.name, roles: parseJsonList(c.roles), city: c.city, state: c.state, website: c.website, phone: c.phone, contacts: c._count.contacts, properties: c._count.properties, link: `/acquisitions/companies/${c.id}` }));
    }
    case "search_contacts": {
      const rows = await prisma.aqContact.findMany({ where: { OR: [{ firstName: { contains: q, mode: ci } }, { lastName: { contains: q, mode: ci } }, { email: { contains: q, mode: ci } }, { phone: { contains: q } }, { secondaryPhone: { contains: q } }, { otherPhones: { contains: q } }, { company: { name: { contains: q, mode: ci } } }] }, take: 25, include: { company: { select: { name: true } }, properties: { include: { property: { select: { address: true, city: true, junkedAt: true } } } }, aqNotes: { orderBy: { createdAt: "desc" }, take: 3, select: { body: true, createdAt: true } } } });
      return rows.map((c) => ({ name: aqFullName(c), roles: parseJsonList(c.roles), company: c.company?.name, phones: [c.phone, c.secondaryPhone, c.otherPhones].filter(Boolean).join("; "), email: c.email, mailingAddress: c.mailingAddress, callResult: c.callResult, lastCallDate: d10(c.lastCallDate), callBackAt: d10(c.callBackAt), followUpAt: d10(c.followUpAt), operatorPipelineStatus: c.operatorPipelineStatus, pipeline: c.pipelineAt ? `on the pipeline list since ${d10(c.pipelineAt)}${c.pipelinePriority ? `, priority ${c.pipelinePriority}` : ""}` : null, properties: c.properties.map((x) => `${x.property.address}${x.property.city ? ", " + x.property.city : ""}${x.property.junkedAt ? " (junk)" : ""}`), recentNotes: c.aqNotes.map((n) => `${d10(n.createdAt)}: ${n.body.slice(0, 160)}`), link: `/acquisitions/contacts/${c.id}` }));
    }
    case "call_backs": {
      const rows = await prisma.aqContact.findMany({ where: { callResult: "Callback", callBackDismissedAt: null }, orderBy: [{ followUpAt: "asc" }, { callBackAt: "asc" }], take: 50, include: { properties: { include: { property: { select: { address: true, junkedAt: true } } } } } });
      return rows.map((c) => ({ name: aqFullName(c), callBack: d10(c.followUpAt ?? c.callBackAt), phones: [c.phone, c.secondaryPhone, c.otherPhones].filter(Boolean).join("; "), properties: c.properties.filter((x) => !x.property.junkedAt).map((x) => x.property.address), link: `/acquisitions/contacts/${c.id}` }));
    }
    case "pipeline": {
      const stages = await getAqDealStages();
      const [active, potential] = await Promise.all([
        prisma.aqProperty.findMany({ where: { junkedAt: null, stages: { contains: '"Deal"' } }, select: { id: true, address: true, city: true, state: true, dealStage: true, askingPrice: true } }),
        prisma.aqProperty.findMany({ where: { junkedAt: null, pipelineAt: { not: null } }, orderBy: [{ pipelinePriority: { sort: "desc", nulls: "last" } }, { pipelineAt: "desc" }], select: { id: true, address: true, city: true, state: true, pipelinePriority: true, pipelineAt: true } }),
      ]);
      return { stages, dealsBoard: active.map((d) => ({ address: d.address, city: d.city, state: d.state, stage: d.dealStage ?? stages[0], askingPrice: d.askingPrice, link: `/acquisitions/properties/${d.id}` })), dealsPipelineList: potential.map((d) => ({ address: d.address, city: d.city, state: d.state, priority: d.pipelinePriority, since: d10(d.pipelineAt), link: `/acquisitions/properties/${d.id}` })) };
    }
    case "waiting_on_shawn": {
      const rows = await waitingOnShawn();
      return rows.map((r) => ({ n: r.n, id: r.id, address: r.address, question: r.question, guess: r.guess, sourceFile: r.sourceFile, since: d10(r.createdAt), link: r.propertyId ? `/acquisitions/properties/${r.propertyId}` : "/acquisitions" }));
    }
    case "junk_phones": {
      const rows = await prisma.aqJunkPhone.findMany({ where: q ? { OR: [{ raw: { contains: q } }, { contactName: { contains: q, mode: ci } }, { reason: { contains: q, mode: ci } }, { sourceFile: { contains: q, mode: ci } }] } : undefined, orderBy: { createdAt: "desc" }, take: 50 });
      return rows.map((r) => ({ number: r.raw, contact: r.contactName, reason: r.reason, date: d10(r.createdAt), sourceFile: r.sourceFile, link: "/acquisitions/junk/phones" }));
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

const AQ_SYSTEM = `You are the RJL Acquisitions CRM assistant. RJL Acquisitions (Shawn Aziz) buys real estate: it tracks properties (address, city and state kept apart; parcel, the business there and its category, acreage, gross SF, year built, last sale, assessed value, zoning, Google rating and reviews, a property report link, the source list it came from), the people around each property as contact cards (the Owner of the real estate, usually behind an LLC; the Operator of the business there; Buyers) with every phone number and email, and the call on each person: Last Call Date, Call Result (Deal, Callback with a target date, Not interested, No answer, Wrong number, Skipped), dated Call Notes and Transcripts, Follow Up Date. Two deal lists: potential deals are sent to the Deals Pipeline list (Send to pipeline, with a 1 to 5 priority); active deals have Deal ticked and sit on the Deals board in a stage. Junk: a property can be moved to Junk Properties with a reason (kept whole, hidden from the lists), and a phone number to Junk Phone Numbers (Wrong number or Bad number), never written onto a contact again. Waiting on Shawn: properties an import held back for his decision; he answers in this chat or on the dashboard.
Answer questions from the CRM's data using the lookups; never guess. Link every property, company or person you mention the first time as a markdown link using the "link" paths returned, e.g. [123 Main St](/acquisitions/properties/abc). A junk property is shown with "(junk)" after its link.
Write for Shawn and Jonathan: plain, direct, short. Lead with the answer. Short bullet lists for several items. Dates as "Sep 3". Money as $1.2MM or $850,000. No dashes as punctuation (no em dashes, no " - " between clauses); plain sentences. No headings unless the answer has several distinct parts.`;

// ---------- the import and rule tools ----------

const DATED = { type: "array", items: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, text: { type: "string" } }, required: ["text"] } };
const JUNK_ROW = { type: "array", items: { type: "object", properties: { number: { type: "string" }, reason: { type: "string", enum: [...AQ_JUNK_PHONE_REASONS] }, contact: { type: "string", description: "the person it belongs to: 'First Last' or email" }, property: { type: "string", description: "the property address it came from" } }, required: ["number"] } };
const ROW_COMPANY = { type: "object", properties: { name: { type: "string" }, roles: { type: "array", items: { type: "string" } }, website: { type: "string" }, phone: { type: "string" }, city: { type: "string" }, state: { type: "string" }, notes: { type: "string" }, contacts: { type: "array", items: { type: "string" }, description: "people at this company: 'First Last' or email" }, properties: { type: "array", items: { type: "string" }, description: "addresses of properties this company is behind" } }, required: ["name"] };
const ROW_CONTACT = {
  type: "object",
  properties: {
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string", description: "Primary Email" },
    emails: { type: "array", items: { type: "string" }, description: "Email (public record): other emails" },
    phone: { type: "string", description: "Primary Phone" },
    secondaryPhone: { type: "string" },
    otherPhones: { type: "array", items: { type: "string" } },
    junkPhones: { ...JUNK_ROW, description: "this person's numbers the file marks wrong, bad, disconnected or junk: junked with the reason, never put on the contact" },
    mailingAddress: { type: "string" },
    company: { type: "string", description: "company name (the owner's LLC, the operator's business), matching a row in companies when there is one" },
    roles: { type: "array", items: { type: "string", enum: [...AQ_ROLES] } },
    title: { type: "string" },
    notes: { type: "string" },
    operatorBrandName: { type: "string" },
    website: { type: "string" },
    operatorEntityName: { type: "string" },
    directoryOperatorName: { type: "string" },
    storePhone: { type: "string" },
    directoryOperatorPhone: { type: "string" },
    operatorTotalLocations: { type: "integer" },
    operatorPipelineStatus: { type: "string", enum: [...AQ_OPERATOR_STATUSES] },
    lastCallDate: { type: "string", description: "YYYY-MM-DD" },
    callResult: { type: "string", enum: [...AQ_STAGES] },
    callBackAt: { type: "string", description: "Callback Target, YYYY-MM-DD, only with the Callback result" },
    followUpAt: { type: "string", description: "Follow Up Date, YYYY-MM-DD" },
    callNotes: { type: "string", description: "one call note with no date of its own (dated the last call date)" },
    notesDated: { ...DATED, description: "every dated call note, one entry each, oldest first" },
    transcripts: { ...DATED, description: "every call transcript with its date, one entry each" },
    sendToPipeline: { type: "boolean", description: "Send to pipeline: onto the Buyers or Operators pipeline list (false takes them off)" },
    pipelinePriority: { type: "integer", description: "1 to 5, 5 highest" },
    properties: { type: "array", items: { type: "string" }, description: "addresses (or parcel IDs) of properties in this import this person is tied to" },
  },
};
const ROW_PROPERTY = {
  type: "object",
  properties: {
    address: { type: "string", description: "street address only" },
    parcelId: { type: "string", description: "the parcel or APN; the first thing an existing property is matched on" },
    city: { type: "string", description: "the town as written; Brick, Brick Township and Brick Township, NJ 08723 are matched as one town" },
    state: { type: "string", description: "two letters" },
    county: { type: "string" },
    neighborhood: { type: "string" },
    businessName: { type: "string", description: "the business operating at the property" },
    category: { type: "string", description: "what kind of business: Auto repair, Tire shop, Oil change" },
    assetType: { type: "string", enum: [...AQ_ASSET_TYPES] },
    zoning: { type: "string" },
    acreage: { type: "number" },
    squareFeet: { type: "integer", description: "gross SF" },
    yearBuilt: { type: "integer" },
    units: { type: "integer" },
    lastSaleDate: { type: "string", description: "YYYY-MM-DD" },
    lastSalePrice: { type: "number" },
    askingPrice: { type: "number" },
    assessedValue: { type: "number" },
    googleRating: { type: "number", description: "0 to 5" },
    reviewCount: { type: "integer", description: "# Reviews" },
    reportUrl: { type: "string", description: "Property Report Link" },
    sourceList: { type: "string", description: "the export the row came from, e.g. 'Brick TK Export 9-26'; defaults to the file name" },
    ownerEntity: { type: "string", description: "the owner of record, usually an LLC (also a company row)" },
    ownerName: { type: "string", description: "the person behind the owner, when there is no contact row for them" },
    primaryPhone: { type: "string" },
    secondaryPhone: { type: "string" },
    otherPhones: { type: "array", items: { type: "string" } },
    primaryEmail: { type: "string" },
    emails: { type: "array", items: { type: "string" } },
    ownerMailingAddress: { type: "string" },
    operatorEntity: { type: "string", description: "the business operating at the property, as a company" },
    operatorName: { type: "string" },
    operatorPhone: { type: "string" },
    operatorEmail: { type: "string" },
    owner: { type: "string", description: "the owner contact row this property links to: 'First Last', email or phone" },
    operator: { type: "string", description: "the operator contact row this property links to" },
    callResult: { type: "string", enum: [...AQ_STAGES], description: "the property's own result; Deal ticks the Deal box" },
    lastCallDate: { type: "string", description: "YYYY-MM-DD" },
    callBackAt: { type: "string", description: "YYYY-MM-DD, only with the Callback result" },
    callNotes: { type: "string" },
    notesDated: { ...DATED, description: "dated notes about the property itself" },
    transcripts: { ...DATED },
    sendToPipeline: { type: "boolean", description: "a potential deal: onto the Deals Pipeline list (false takes it off)" },
    pipelinePriority: { type: "integer", description: "1 to 5 on the Deals Pipeline list" },
    deal: { type: "boolean", description: "an active deal: tick Deal, onto the Deals board (false: back to a potential deal on the Deals Pipeline list)" },
    dealStage: { type: "string", description: "the Deals board stage, with deal true" },
    junk: { type: "boolean", description: "move the property to Junk Properties" },
    junkReason: { type: "string", description: "Removed Reason: gas station, too small, corporate-owned, duplicate of 656 Ocean Rd" },
    hold: { type: "boolean", description: "HOLD: do not write this property yet; ask Shawn first (conflicting tags, an unclear duplicate, a call you cannot read). It goes on the Waiting on Shawn list with holdQuestion and holdGuess; everything else imports" },
    holdQuestion: { type: "string", description: "plain English, what you saw and your best guess, e.g. '656 Ocean Rd: you tagged it Pipeline, then later noted it is a gas station and tagged it Remove. It looks like it should go to Junk. Please confirm.'" },
    holdGuess: { type: "string", enum: ["junk", "pipeline", "deal", "live"], description: "your best guess: junk (Junk Properties), pipeline (Deals Pipeline list), deal (Deals board), live (a normal property)" },
    notes: { type: "string" },
    companies: { type: "array", items: { type: "string" }, description: "company names linked to this property" },
    contacts: { type: "array", items: { type: "string" }, description: "other people linked to this property, by email, 'First Last' or phone" },
  },
  required: ["address"],
};

function importTool(ws: Workspace): Anthropic.Tool {
  const props: Record<string, unknown> = {
    summary: { type: "string", description: "one or two plain sentences on what the file held and how it was read" },
    companies: { type: "array", items: ROW_COMPANY },
    contacts: { type: "array", items: ROW_CONTACT },
  };
  if (ws === "AQ") {
    props.sourceFile = { type: "string", description: "the file's name, kept as Source File / Source List on what it creates" };
    props.properties = { type: "array", items: ROW_PROPERTY };
    props.junkPhones = { ...JUNK_ROW, description: "every number the file marks wrong, bad, disconnected or junk that is not on a contact row, with the reason, the person and the property" };
    props.unsure = { type: "array", items: { type: "string" }, description: "everything you were not sure about: a column you could not place, a row with no address or parcel, two rows that may be the same property, a value that did not fit a field" };
  } else props.junkPhones = { type: "array", items: { type: "string" } };
  return {
    name: "propose_import",
    description: `Propose records to write into ${NAMES[ws]} from an attached file or from what the user wrote. The user sees the rows and clicks Import; nothing is written until then. Include every usable row. Leave a field out rather than inventing it. Call it once per file with all the rows.`,
    input_schema: { type: "object", properties: props, required: ["summary"] },
  };
}

const SAVE_RULE: Anthropic.Tool = {
  name: "save_rule",
  description: "Save one Data rule for reading this side's files, when the user teaches you something about their files or corrects a reading (\"the Owner column is the seller\", \"skip rows marked DNC\", \"remember: prices are in thousands\"). One short plain sentence, general enough to apply to the next file. Saved rules are read before every file.",
  input_schema: { type: "object", properties: { rule: { type: "string" } }, required: ["rule"] },
};
const RESOLVE_PENDING: Anthropic.Tool = {
  name: "resolve_pending",
  description: "Shawn's answer on a held property from the Waiting on Shawn list (look it up first with waiting_on_shawn to get the ids). action confirm applies the best guess; junk, pipeline, deal or live overrides it; dismiss writes nothing. One call per property; 'yes to all' is one call per item with confirm. The held rows are then written.",
  input_schema: { type: "object", properties: { id: { type: "string" }, action: { type: "string", enum: ["confirm", "junk", "pipeline", "deal", "live", "dismiss"] }, dealStage: { type: "string", description: "with deal: the Deals board stage" }, junkReason: { type: "string", description: "with junk: the Removed Reason" }, answer: { type: "string", description: "Shawn's words, kept on the record" } }, required: ["id", "action"] },
};
const SAVE_IMPORT_INSTRUCTIONS: Anthropic.Tool = {
  name: "save_import_instructions",
  description: "Save the user's standing import instructions: directions meant for every file from now on (\"for every export: fold the rows by parcel, junk numbers marked WN as Wrong number, put the list name in Source List\"). Kept whole under Settings > Import instructions and read before every file. mode replace rewrites the whole set with the text given; append adds to it. Do not save a one-off request about the file in hand.",
  input_schema: { type: "object", properties: { text: { type: "string" }, mode: { type: "string", enum: ["replace", "append"] } }, required: ["text", "mode"] },
};

function importGuide(ws: Workspace, rules: string[], instructions: string): string {
  const fields =
    ws === "AQ"
      ? `PROPERTIES (the real estate): address (street only), parcelId, city, state (2 letters), county, neighborhood, businessName, category, assetType (${AQ_ASSET_TYPES.join(", ")}), zoning, acreage, squareFeet, yearBuilt, units, lastSaleDate, lastSalePrice, askingPrice, assessedValue, googleRating, reviewCount, reportUrl, sourceList, notes, the deal lists (sendToPipeline + pipelinePriority for a potential deal; deal true + dealStage for an active deal; deal false sends an active deal back to potential), junk + junkReason, callResult (${AQ_STAGES.join(", ")}) for the property's own result, dated notesDated and transcripts, companies, contacts, owner, operator.
PEOPLE ARE CONTACT ROWS: the owner of the real estate is a contact with roles ["Owner"] and company = the owner entity (usually an LLC); the operator of the business there is a contact with roles ["Operator"], company = the business, plus operatorBrandName, website, operatorEntityName, directoryOperatorName, storePhone, directoryOperatorPhone, operatorTotalLocations, operatorPipelineStatus (${AQ_OPERATOR_STATUSES.join(", ")}) when the sheet has them; buyers have roles ["Buyer"]. Every contact carries phone (Primary), secondaryPhone, otherPhones, email (Primary), emails (public record), mailingAddress, and the call: lastCallDate, callResult (${AQ_STAGES.join(", ")}), callBackAt (Callback Target), followUpAt, notesDated (every dated call note as its own entry) and transcripts (each with its date), sendToPipeline + pipelinePriority for Buyers and Operators. Put the property addresses the person is tied to in the contact's properties list, and name the owner and operator on the property row (owner, operator) so they link. Make a company row for each owner entity and each operator business.
ONE ROW PER PHONE NUMBER: Shawn's call lists carry one row per number, several rows per property. Fold them: one property row per parcel (or address), one contact row per person, every number on that person as phone, secondaryPhone and otherPhones, every dated note and transcript as its own entry. Never make two property rows for the same parcel.
CALL RESULTS: Deal means the property is an active deal (deal true). Callback needs callBackAt. Wrong number: the number goes in junkPhones with reason "Wrong number" (a bad or disconnected line is "Bad number"); the person's other numbers stay. Skipped means the row was on the list but never dialed, for no reason; it is a normal live property and triggers nothing. Not interested and No answer are recorded as written.
MATCHING is done by the CRM on Import: a property by Parcel ID first, then by its normalized address and town (Brick, Brick Township and "Brick Township, NJ 08723" are one town), so give the parcel and the town as the file has them; a person by name plus a phone or an email. A matched record is updated, not duplicated, and a note or transcript already there (same text, same date) is not added twice. Every field you give is written onto the matched record, so give a field only when the file says so.`
      : ws === "IL"
        ? `Companies: name, roles (${IL_ROLES.join(", ")}), website, phone, city, notes. Contacts: firstName, lastName, email, phone, company (name), roles (${IL_ROLES.join(", ")}), notes.`
        : `Companies: name, roles (${CA_ROLES.join(", ")}), website, phone, city, state, notes. Contacts: firstName, lastName, email, phone, company (name), roles (${CA_ROLES.join(", ")}), title, notes.`;
  const hold =
    ws === "AQ"
      ? `
HOLD AND ASK. When a property needs Shawn to decide (the same property tagged both Pipeline and Remove, two rows that may be the same property, a conversation you cannot read, a junk property an export tags Pipeline, Deal or Callback), do not guess and do not drop it: set hold true on that property row with holdQuestion (what you saw, your best guess) and holdGuess. Every other row imports normally; a held property is not written anywhere (not the pipeline, not the dashboard, not Junk) and an existing one stays as it was. After the import the held properties sit on the Waiting on Shawn list (the dashboard, and waiting_on_shawn here). In your reply after proposing, ask each held question in plain English, numbered. When Shawn answers ("yes to all", "yes on 1 and 3, put 2 in the pipeline", "656 Ocean is a duplicate, junk it"), call waiting_on_shawn to get the list and ids, then resolve_pending once per property with confirm or the action he gave, and tell him in one line each what was done.`
      : "";
  const junk =
    ws === "AQ"
      ? `
JUNK. A file marks phone numbers as wrong, bad, disconnected or junk, and rows as junk, dead, do not pursue, gas station, too small, corporate-owned or a duplicate. Put every such number in junkPhones with its reason (${AQ_JUNK_PHONE_REASONS.join(" or ")}), the person and the property, never in phone, secondaryPhone or otherPhones; set junk true with junkReason on such a property row. The CRM keeps them under Junk > Junk Phone Numbers and Junk Properties, never writes a junk number onto a contact, and a Restore puts either back.`
      : "";
  const standing =
    ws === "AQ"
      ? `
STANDING IMPORT INSTRUCTIONS (Settings > Import instructions; follow them for every file):
${instructions.trim() || "(none yet)"}
When the user gives directions for every file from now on, call save_import_instructions (append, or replace when they restate the whole set), then confirm in one line. A one-off request for the file in hand is not saved.`
      : "";
  return `${junk}${hold}

FILES. When a file is attached, read it with the standing instructions and the Data rules below, work out what each column means from its header and its values, and call propose_import once with every usable row. Then tell the user in a few lines what the file held, how you read the columns, and anything you were unsure about (also listed in unsure). Do not list every row in text; the user sees the rows in the proposal. If the file cannot be read as records, say what you see and ask what they want done with it. If the user asks a question about the file rather than to load it, answer the question.
Fields you can fill: ${fields}
Never invent a value; leave the field out. Phone numbers as written. Do not fill a field from a guess about a name.

TEACHING. When the user tells you how their files work, or corrects how you read one ("that column is the neighborhood, not the city", "remember, DNC means Not interested", "from now on skip the first sheet"), call save_rule with one short general sentence, then confirm in one line. Apply the rule at once to the file in hand and call propose_import again with the corrected rows. Never save a rule the user did not state or imply.
${standing}
DATA RULES for ${NAMES[ws]} (what the team has taught so far; follow every one):
${rules.length ? rules.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(none yet)"}`;
}

// ---------- the turn ----------

export async function assistantTurn(ws: Workspace, history: HistoryMessage[], userName: string): Promise<TurnResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { answer: "Claude is not configured on this server.", lookups: [], proposal: null, savedRules: [] };
  const [rules, instructions] = await Promise.all([loadDataRules(ws), ws === "AQ" ? importInstructionsText().then((r) => r.text) : Promise.resolve("")]);
  const base = ws === "IL" ? IL_SYSTEM : ws === "AQ" ? AQ_SYSTEM : CA_SYSTEM;
  const lookups = ws === "IL" ? IL_TOOLS : ws === "AQ" ? AQ_LOOKUPS : CA_TOOLS;
  const exec = ws === "IL" ? runIl : ws === "AQ" ? runAq : runCa;
  const tools: Anthropic.Tool[] = [...lookups, importTool(ws), SAVE_RULE, ...(ws === "AQ" ? [SAVE_IMPORT_INSTRUCTIONS, RESOLVE_PENDING] : [])];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  // the long, stable part of the system prompt (the guide, the standing instructions, the rules) is cached across turns; the date and name sit after it
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: `${base}\n${importGuide(ws, rules, instructions)}`, cache_control: { type: "ephemeral" } }, { type: "text", text: `Today is ${today}. You are talking with ${userName}.` }];
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = history.slice(-14).map((m) => ({ role: m.role, content: m.content }));
  const used: string[] = [];
  const savedRules: string[] = [];
  let proposal: Proposal | null = null;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // streamed: a big call list takes minutes to read and propose, and the SDK refuses a plain request that may run past ten (Shawn's first export, Oct 5, 2026)
    const res = await client.messages.stream({ model: "claude-opus-5", max_tokens: 64_000, system, tools, messages }).finalMessage();
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
          out = { ok: true, rows: n, junkNumbers: proposal.junkPhones?.length ?? 0, note: "The user now sees these rows with an Import button. Summarize briefly; do not repeat the rows." };
        } else if (tu.name === "save_rule") {
          const r = await appendDataRule(ws, String(input.rule ?? ""));
          if (r.added) savedRules.push(String(input.rule).trim());
          used.push(`save_rule(${JSON.stringify(String(input.rule ?? "").slice(0, 80))})`);
          out = { ok: true, added: r.added, rules: r.rules.length };
        } else if (tu.name === "resolve_pending") {
          const r = await resolvePendingImport(String(input.id ?? ""), (["confirm", "junk", "pipeline", "deal", "live", "dismiss"].includes(String(input.action)) ? String(input.action) : "confirm") as ResolveAction, { dealStage: typeof input.dealStage === "string" ? input.dealStage : undefined, junkReason: typeof input.junkReason === "string" ? input.junkReason : undefined, answer: typeof input.answer === "string" ? input.answer : undefined });
          used.push(`resolve_pending(${input.action})`);
          out = r.ok ? { ok: true, did: r.did, report: r.report } : { error: r.reason };
        } else if (tu.name === "save_import_instructions") {
          const text = await updateImportInstructions(String(input.text ?? ""), input.mode === "replace" ? "replace" : "append");
          savedRules.push(`Import instructions ${input.mode === "replace" ? "replaced" : "added to"} (Settings > Import instructions)`);
          used.push(`save_import_instructions(${input.mode})`);
          out = { ok: true, instructions: text, note: "Saved under Settings > Import instructions; every later file is read with them." };
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
const list = (v: unknown, allowed?: readonly string[]) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter((x): x is string => Boolean(x)).filter((x) => !allowed || allowed.includes(x)) : undefined);

/** Only fields we know, only values that are there. The Acquisitions shape is cleaned in aq-import.ts. */
function cleanProposal(ws: Workspace, p: Proposal, dealStages: string[]): Proposal {
  if (ws === "AQ") return cleanAqProposal(p, dealStages);
  const roles = ws === "IL" ? IL_ROLES : CA_ROLES;
  const out: Proposal = { summary: str(p.summary, 600) ?? "", junkPhones: list(p.junkPhones)?.map((number) => ({ number })) };
  const companies = (Array.isArray(p.companies) ? p.companies : []).flatMap((c): CompanyRow[] => {
    const name = str(c.name, 160);
    return name ? [{ name, roles: list(c.roles, roles), website: str(c.website), phone: str(c.phone, 60), city: str(c.city, 80), state: str(c.state, 40), notes: str(c.notes, 1000) }] : [];
  });
  const contacts = (Array.isArray(p.contacts) ? p.contacts : [])
    .map((c): ContactRow => ({ firstName: str(c.firstName, 80), lastName: str(c.lastName, 80), email: str(c.email, 160)?.toLowerCase(), phone: str(c.phone, 60), company: str(c.company, 160), roles: list(c.roles, roles), title: str(c.title, 120), notes: str(c.notes, 1000) }))
    .filter((c) => c.firstName || c.lastName || c.email);
  if (companies.length) out.companies = companies;
  if (contacts.length) out.contacts = contacts;
  return out;
}

// ---------- Import ----------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const domainOfUrl = (w: string | undefined) => (w ? w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() || null : null);

/** Write a proposal into the side. Acquisitions goes through aq-import.ts; on the other sides existing rows are matched (company by name, person by email or name at the company) and only their empty fields are filled; new ones are created. */
export async function runImport(ws: Workspace, p: Proposal): Promise<ImportResult> {
  if (ws === "AQ") return runAqImport(p);
  const result: ImportResult = { created: { properties: 0, companies: 0, contacts: 0 }, matched: { properties: 0, companies: 0, contacts: 0 }, links: [], skipped: [] };
  const link = (label: string, href: string) => {
    if (result.links.length < 40) result.links.push({ label, href });
  };
  const companyIds = new Map<string, string>(); // norm(name) → id

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
