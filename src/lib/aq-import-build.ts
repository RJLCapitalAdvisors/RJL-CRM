import type { CompanyRow, ContactRow, DatedText, JunkPhoneRow, Proposal, PropertyRow } from "@/lib/aq-import";
import type { Reading } from "@/lib/aq-import-read";
import { dialed, isBadNumber, lastCallOf, type Person, type PhoneRow, type PropertyGroup } from "@/lib/aq-terakotta";

/**
 * From a folded property and its reading to the rows runAqImport writes (Oct 7, 2026). Everything mechanical in Shawn's
 * Import instructions happens here, in code: phone order on each card, junk numbers off every card, public-record
 * emails vs the Primary Email, the owner and operator companies, the call landing on whoever he spoke with, every
 * dated note and transcript. Claude's reading supplies only the judgment (result, lists, junk, hold).
 */

/** Shawn's changes on the review page: the outcome and the list a property goes to. */
export type Override = { outcome?: "live" | "junk" | "pipeline" | "deal"; junkReason?: string; callResult?: string; callBackDate?: string };

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;
/** "Richard Irvin Kohls" → Richard / Kohls, as the earlier imports stored people (a re-import then finds the same card). */
export function splitName(name: string): { firstName?: string; lastName?: string } {
  const parts = name.replace(/[,]/g, " ").split(/\s+/).filter(Boolean);
  while (parts.length > 2 && SUFFIX.test(parts.at(-1)!)) parts.pop();
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.at(-1) };
}
const day = (iso: string | undefined) => iso?.slice(0, 10);
const vacant = (s: string | undefined) => !s || /vacant|unconfirmed|^n\/?a$/i.test(s);

/** What the review page and the import both use: the reading with Shawn's override applied. */
export function effective(r: Reading, o: Override | undefined): Reading {
  if (!o?.outcome && !o?.callResult) return r;
  const e: Reading = { ...r };
  if (o.outcome) {
    e.question = undefined;
    e.guess = undefined;
    if (o.outcome === "junk") Object.assign(e, { outcome: "junk", junkReason: o.junkReason ?? r.junkReason ?? "removed on Shawn's say-so", pipeline: undefined, deal: undefined, callResult: r.callResult === "Callback" || r.callResult === "Deal" ? undefined : r.callResult, callBackDate: undefined });
    else if (o.outcome === "pipeline") Object.assign(e, { outcome: "live", pipeline: true, deal: undefined, callResult: r.callResult === "Deal" ? undefined : r.callResult });
    else if (o.outcome === "deal") Object.assign(e, { outcome: "live", deal: true, pipeline: undefined, callResult: "Deal" });
    else Object.assign(e, { outcome: "live", pipeline: undefined, deal: undefined, callResult: r.callResult === "Deal" ? undefined : r.callResult });
  }
  if (o.callResult !== undefined) {
    e.callResult = o.callResult || undefined;
    e.callBackDate = o.callResult === "Callback" ? o.callBackDate ?? r.callBackDate : undefined;
  }
  return e;
}

/** One property's slice of the proposal: the property row, its people, its companies, its junk numbers. */
export function buildProposalPart(g: PropertyGroup, r: Reading, sourceFile: string, inCrm: boolean): { property: PropertyRow; contacts: ContactRow[]; companies: CompanyRow[]; junkPhones: JunkPhoneRow[] } {
  const f = g.facts;
  const wrong = new Map((r.wrong ?? []).map((w) => [w.phone, w.reason]));
  const isJunk = (p: PhoneRow) => isBadNumber(p) || wrong.has(p.digits);
  const nameOf = (key: string | null) => g.people.find((p) => p.key === key)?.name;

  // ----- junk numbers: off every card, onto Junk Phone Numbers with the person and the property -----
  const junkPhones: JunkPhoneRow[] = g.phones.filter(isJunk).map((p) => ({ number: p.number, reason: wrong.get(p.digits) ?? (/bad number/i.test(p.disposition ?? "") ? "Bad number" : "Wrong number"), contact: nameOf(p.person) ?? (p.slot.startsWith("Store") ? f.businessName : undefined), property: f.address }));
  const good = g.phones.filter((p) => !isJunk(p));

  // ----- whose call it was -----
  const anyDialed = g.phones.some(dialed);
  const last = lastCallOf(g);
  const allNotes: DatedText[] = g.phones.flatMap((p) => p.notes.map((n) => ({ date: day(n.date), text: n.text })));
  if (r.autoNote) allNotes.push({ date: day(last), text: r.autoNote });
  const skip = new Set(r.skipTranscripts ?? []);
  const transcripts: DatedText[] = g.phones.filter((p) => p.transcript && !skip.has(p.digits) && p.transcript.replace(/^(Prospect|Shawn Aziz):/gm, "").trim().length > 25).map((p) => ({ date: day(p.lastCall), text: p.transcript! }));
  const callKey: string | null = r.callPerson === "operator" ? (r.operatorPerson ? "operator" : g.people[0]?.key ?? null) : r.callPerson ?? g.people[0]?.key ?? null;
  const result = r.callResult;
  const call = {
    lastCallDate: anyDialed ? day(last) : undefined,
    callResult: anyDialed ? result : undefined,
    callBackAt: result === "Callback" ? r.callBackDate : undefined,
    followUpAt: result === "Callback" ? r.callBackDate : undefined,
    notesDated: allNotes.length ? allNotes : undefined,
    transcripts: transcripts.length ? transcripts : undefined,
  };

  // ----- companies -----
  const companies: CompanyRow[] = [];
  const store = good.filter((p) => p.slot.startsWith("Store"));
  const business = vacant(f.businessName) ? undefined : f.businessName;
  if (f.ownerEntity) companies.push({ name: f.ownerEntity, roles: ["Owner"], properties: [f.address] });
  if (business) companies.push({ name: business, roles: ["Operator"], phone: store[0]?.number, properties: [f.address] });

  // ----- people -----
  const contacts: ContactRow[] = [];
  const order = (p: PhoneRow) => {
    const m = p.slot.match(/(\d)/);
    return (p.slot.startsWith("T Phone") ? 0 : 10) + Number(m?.[1] ?? 9);
  };
  for (const person of g.people) contacts.push(personRow(person, g, r, good, order, business, f.ownerEntity, f.address, callKey === person.key ? call : undefined));
  if (r.operatorPerson) {
    const { firstName, lastName } = splitName(r.operatorPerson.name);
    const extra = (r.extraPhones ?? []).filter((x) => x.person === "operator").map((x) => x.phone);
    const phones = [r.operatorPerson.phone, ...extra].filter((x): x is string => Boolean(x));
    const emails = [r.operatorPerson.email, ...(r.emails ?? []).filter((x) => x.person === "operator").map((x) => x.email)].filter((x): x is string => Boolean(x));
    contacts.push({
      firstName,
      lastName,
      roles: ["Operator"],
      company: business,
      phone: phones[0],
      secondaryPhone: phones[1],
      email: emails[0],
      storePhone: store[0]?.number,
      sendToPipeline: r.expandingOperator === "operator" ? true : undefined,
      operatorPipelineStatus: r.expandingOperator === "operator" ? "Pipeline" : undefined,
      properties: [f.address],
      ...(callKey === "operator" ? call : {}),
    });
  }

  // ----- the property -----
  const noPeople = !g.people.length;
  const tPhones = good.filter((p) => !p.slot.startsWith("Store")).sort((a, b) => order(a) - order(b));
  const property: PropertyRow = {
    ...f,
    sourceList: sourceFile,
    notes: [f.notes, r.propertyNote].filter(Boolean).join("\n") || undefined,
    callResult: anyDialed || !inCrm ? (r.outcome === "junk" && (result === "Callback" || result === "Deal") ? undefined : result) : undefined,
    lastCallDate: anyDialed ? day(last) : undefined,
    callBackAt: result === "Callback" ? r.callBackDate : undefined,
    sendToPipeline: r.outcome !== "junk" && r.pipeline ? true : undefined,
    pipelinePriority: r.pipeline ? r.priority : undefined,
    deal: r.outcome !== "junk" && r.deal ? true : undefined,
    dealStage: r.deal ? r.dealStage : undefined,
    junk: r.outcome === "junk" ? true : undefined,
    junkReason: r.outcome === "junk" ? r.junkReason ?? "doesn't fit" : undefined,
    hold: r.outcome === "hold" ? true : undefined,
    holdQuestion: r.outcome === "hold" ? r.question ?? r.why : undefined,
    holdGuess: r.outcome === "hold" ? r.guess ?? "live" : undefined,
    owner: g.people[0]?.name,
    operator: r.operatorPerson?.name,
    contacts: g.people.slice(1).map((p) => p.name),
    companies: companies.map((c) => c.name),
    // no names in the file: the numbers and the calls sit on the property, and the importer makes a card from the phones
    ...(noPeople
      ? { primaryPhone: tPhones[0]?.number, secondaryPhone: tPhones[1]?.number, otherPhones: tPhones.slice(2).map((p) => p.number), notesDated: call.notesDated, transcripts: call.transcripts }
      : {}),
  };
  if (property.junk) property.callBackAt = undefined;
  return { property, contacts, companies, junkPhones };
}

function personRow(person: Person, g: PropertyGroup, r: Reading, good: PhoneRow[], order: (p: PhoneRow) => number, business: string | undefined, ownerEntity: string | undefined, address: string, call: Partial<ContactRow> | undefined): ContactRow {
  const mine = good.filter((p) => p.person === person.key).sort((a, b) => order(a) - order(b));
  const reached = (r.primary ?? []).find((x) => x.person === person.key)?.phone;
  const correct = mine.find((p) => p.tags.some((t) => /correct number/i.test(t)))?.digits;
  const given = (r.extraPhones ?? []).filter((x) => x.person === person.key).map((x) => x.phone);
  const first = mine.find((p) => p.digits === (reached ?? correct)) ?? mine[0];
  // Primary: the number he reached them on (or tagged Correct number), else T Phone 1. Secondary: a number they gave
  // or he typed in a note, else the next in order. Other Phones: every remaining good number.
  const rest = mine.filter((p) => p !== first).map((p) => p.number);
  const ordered = [first?.number, ...given, ...rest].filter((x): x is string => Boolean(x));
  const seen = new Set<string>();
  const phones = ordered.filter((n) => {
    const d = n.replace(/\D/g, "").slice(-10);
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });
  const roles = ["Owner", ...((r.ownerRunsBusiness ?? []).includes(person.key) || r.expandingOperator === person.key ? ["Operator"] : []), ...(r.buyer === person.key ? ["Buyer"] : [])];
  const typed = (r.emails ?? []).filter((x) => x.person === person.key).map((x) => x.email);
  return {
    ...splitName(person.name),
    roles,
    company: ownerEntity ?? ((r.ownerRunsBusiness ?? []).includes(person.key) ? business : undefined),
    phone: phones[0],
    secondaryPhone: phones[1],
    otherPhones: phones.length > 2 ? phones.slice(2) : undefined,
    email: typed[0],
    emails: person.emails.length ? person.emails : undefined,
    mailingAddress: person.mailingAddress,
    notes: person.unconfirmed ? "Unconfirmed name" : undefined,
    sendToPipeline: r.expandingOperator === person.key || r.buyer === person.key ? true : undefined,
    operatorPipelineStatus: r.expandingOperator === person.key ? "Pipeline" : undefined,
    properties: [address],
    ...(call ?? {}),
  };
}

/** A chunk of properties as one Proposal for runAqImport. */
export function buildProposal(parts: ReturnType<typeof buildProposalPart>[], sourceFile: string): Proposal {
  const companies = new Map<string, CompanyRow>();
  for (const c of parts.flatMap((p) => p.companies)) {
    const k = c.name.toLowerCase();
    const cur = companies.get(k);
    companies.set(k, cur ? { ...cur, roles: [...new Set([...(cur.roles ?? []), ...(c.roles ?? [])])], properties: [...(cur.properties ?? []), ...(c.properties ?? [])], phone: cur.phone ?? c.phone } : c);
  }
  return { summary: `Import section: ${sourceFile}`, sourceFile, properties: parts.map((p) => p.property), contacts: parts.flatMap((p) => p.contacts), companies: [...companies.values()], junkPhones: parts.flatMap((p) => p.junkPhones) };
}
