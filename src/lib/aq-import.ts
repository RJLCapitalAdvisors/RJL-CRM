import { prisma } from "@/lib/db";
import { AQ_ASSET_TYPES, AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, digitsOf, ensureLlc, lines, mergeAqRoles, normalizeAddress, normalizePhone, normalizeTown, parseJsonList, toJsonList } from "@/lib/acquisitions";
import { getAqDealStages } from "@/lib/acquisitions-stages";
import { addJunkPhone, junkPhoneDigits } from "@/app/acquisitions/junk-actions";

/**
 * The Acquisitions importer behind Ask the CRM (Oct 5, 2026; the first version was Sep 18). Shawn's Terakotta call
 * lists come as CSVs with one row per phone number; the assistant folds them into properties, their owners and
 * operators, companies, dated call notes and transcripts, the two deal lists and junk, and proposes it all. Once
 * Shawn clicks Import this file writes it: existing properties are matched by Parcel ID, then by the normalized
 * address and town ("Brick", "Brick Township" and "Brick Township, NJ 08723" are one town); people by name plus a
 * phone or an email; a note or transcript already there (same text, same day) is not added twice; a junk number is
 * never written onto anyone; a newer call result is never overwritten by an older one; a deal is never moved
 * backward on the board. A property the assistant (or this file) cannot settle is held as an AqPendingImport, asked
 * about in the chat and on the dashboard's Waiting on Shawn list, and written only once Shawn answers. The report
 * says what happened and lists what was unsure.
 */

export type DatedText = { date?: string; text: string };
export type JunkPhoneRow = { number: string; reason?: string; contact?: string; property?: string };
export type HoldGuess = "junk" | "pipeline" | "deal" | "live";
export type CompanyRow = { name: string; roles?: string[]; website?: string; phone?: string; city?: string; state?: string; notes?: string; contacts?: string[]; properties?: string[] };
export type ContactRow = {
  firstName?: string; lastName?: string; email?: string; emails?: string[]; phone?: string; secondaryPhone?: string; otherPhones?: string[]; junkPhones?: JunkPhoneRow[]; mailingAddress?: string; company?: string; roles?: string[]; title?: string; notes?: string;
  operatorBrandName?: string; website?: string; operatorEntityName?: string; directoryOperatorName?: string; storePhone?: string; directoryOperatorPhone?: string; operatorTotalLocations?: number; operatorPipelineStatus?: string;
  lastCallDate?: string; callResult?: string; callBackAt?: string; followUpAt?: string; callNotes?: string; notesDated?: DatedText[]; transcripts?: DatedText[];
  sendToPipeline?: boolean; pipelinePriority?: number; properties?: string[];
};
export type PropertyRow = {
  address: string; parcelId?: string; city?: string; state?: string; county?: string; neighborhood?: string; businessName?: string; category?: string; assetType?: string; zoning?: string;
  acreage?: number; squareFeet?: number; yearBuilt?: number; units?: number; lastSaleDate?: string; lastSalePrice?: number; askingPrice?: number; assessedValue?: number; googleRating?: number; reviewCount?: number; reportUrl?: string; sourceList?: string;
  ownerEntity?: string; ownerName?: string; primaryPhone?: string; secondaryPhone?: string; otherPhones?: string[]; primaryEmail?: string; emails?: string[]; ownerMailingAddress?: string; operatorEntity?: string; operatorName?: string; operatorPhone?: string; operatorEmail?: string;
  callResult?: string; lastCallDate?: string; callBackAt?: string; callNotes?: string; notesDated?: DatedText[]; transcripts?: DatedText[];
  sendToPipeline?: boolean; deal?: boolean; dealStage?: string; pipelinePriority?: number; junk?: boolean; junkReason?: string; notes?: string; companies?: string[]; contacts?: string[]; owner?: string; operator?: string;
  hold?: boolean; holdQuestion?: string; holdGuess?: HoldGuess;
};
export type Proposal = { summary: string; sourceFile?: string; properties?: PropertyRow[]; companies?: CompanyRow[]; contacts?: ContactRow[]; junkPhones?: JunkPhoneRow[]; unsure?: string[] };
export type WaitingItem = { id: string; address: string; question: string; guess: HoldGuess };
export type AqImportReport = {
  properties: { new: number; updated: number; junked: number; skipped: number };
  contacts: { new: number; updated: number };
  companies: { new: number; updated: number };
  numbersJunked: number;
  pipeline: string[];
  callbacks: string[];
  notes: number;
  transcripts: number;
  waiting: WaitingItem[];
  unsure: string[];
};
export type ImportResult = { created: { properties: number; companies: number; contacts: number }; matched: { properties: number; companies: number; contacts: number }; links: { label: string; href: string }[]; skipped: string[]; report?: AqImportReport };
type PendingPayload = { property: PropertyRow; contacts: ContactRow[]; companies: CompanyRow[]; junkPhones: JunkPhoneRow[] };

const ci = "insensitive" as const;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const domainOfUrl = (w: string | undefined) => (w ? w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() || null : null);
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00`) : null);
const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
const sameText = (a: string, b: string) => norm(a) === norm(b);
const url = (u: string | undefined) => (u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : undefined);
/** Only the fields that carry a value: a provided value is written, an absent one leaves the record alone. */
const given = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
const GUESSES: HoldGuess[] = ["junk", "pipeline", "deal", "live"];

// ---------- the proposal, cleaned ----------

const str = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) && v.trim() ? n : undefined;
  }
  return undefined;
};
const int = (v: unknown) => (num(v) != null ? Math.round(num(v)!) : undefined);
const isoDay = (v: unknown) => {
  const t = str(v, 30);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};
const list = (v: unknown, allowed?: readonly string[]) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter((x): x is string => Boolean(x)).filter((x) => !allowed || allowed.includes(x)) : undefined);
const dated = (v: unknown): DatedText[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((x): DatedText[] => {
    if (typeof x === "string") return x.trim() ? [{ text: x.trim().slice(0, 8000) }] : [];
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const text = str(o.text ?? o.body ?? o.note, 8000);
      return text ? [{ text, date: isoDay(o.date) }] : [];
    }
    return [];
  });
  return out.length ? out : undefined;
};
const junkRows = (v: unknown): JunkPhoneRow[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((x): JunkPhoneRow[] => {
    if (typeof x === "string") return digitsOf(x).length >= 6 ? [{ number: x.trim() }] : [];
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const number = str(o.number ?? o.phone, 60);
      return number && digitsOf(number).length >= 6 ? [{ number, reason: str(o.reason, 80), contact: str(o.contact, 160), property: str(o.property, 200) }] : [];
    }
    return [];
  });
  return out.length ? out : undefined;
};
const bool = (v: unknown) => (v === true || v === "true" || v === "yes" || v === "Yes" ? true : v === false || v === "false" || v === "no" || v === "No" ? false : undefined);
const priority = (v: unknown) => {
  const n = int(v);
  return n == null ? undefined : Math.min(5, Math.max(1, n));
};

/** Only fields we know, only values that are there. */
export function cleanAqProposal(p: Proposal, dealStages: string[]): Proposal {
  const out: Proposal = { summary: str(p.summary, 800) ?? "", sourceFile: str(p.sourceFile, 200), junkPhones: junkRows(p.junkPhones), unsure: list(p.unsure)?.slice(0, 40) };
  const companies = (Array.isArray(p.companies) ? p.companies : []).flatMap((c): CompanyRow[] => {
    const name = str(c.name, 160);
    return name ? [{ name, roles: list(c.roles, AQ_ROLES), website: str(c.website), phone: str(c.phone, 60), city: str(c.city, 80), state: str(c.state, 2)?.toUpperCase(), notes: str(c.notes, 2000), contacts: list(c.contacts), properties: list(c.properties) }] : [];
  });
  const contacts = (Array.isArray(p.contacts) ? p.contacts : [])
    .map(
      (c): ContactRow => ({
        firstName: str(c.firstName, 80),
        lastName: str(c.lastName, 80),
        email: str(c.email, 160)?.toLowerCase(),
        emails: list(c.emails)?.map((e) => e.toLowerCase()),
        phone: str(c.phone, 60),
        secondaryPhone: str(c.secondaryPhone, 60),
        otherPhones: list(c.otherPhones),
        junkPhones: junkRows(c.junkPhones),
        mailingAddress: str(c.mailingAddress, 240),
        company: str(c.company, 160),
        roles: list(c.roles, AQ_ROLES),
        title: str(c.title, 120),
        notes: str(c.notes, 2000),
        operatorBrandName: str(c.operatorBrandName, 160),
        website: str(c.website, 200),
        operatorEntityName: str(c.operatorEntityName, 160),
        directoryOperatorName: str(c.directoryOperatorName, 160),
        storePhone: str(c.storePhone, 60),
        directoryOperatorPhone: str(c.directoryOperatorPhone, 60),
        operatorTotalLocations: int(c.operatorTotalLocations),
        operatorPipelineStatus: (AQ_OPERATOR_STATUSES as readonly string[]).includes(str(c.operatorPipelineStatus, 40) ?? "") ? str(c.operatorPipelineStatus, 40) : undefined,
        lastCallDate: isoDay(c.lastCallDate),
        callResult: (AQ_STAGES as readonly string[]).includes(str(c.callResult, 40) ?? "") ? str(c.callResult, 40) : undefined,
        callBackAt: isoDay(c.callBackAt),
        followUpAt: isoDay(c.followUpAt),
        callNotes: str(c.callNotes, 4000),
        notesDated: dated(c.notesDated),
        transcripts: dated(c.transcripts),
        sendToPipeline: bool(c.sendToPipeline),
        pipelinePriority: priority(c.pipelinePriority),
        properties: list(c.properties),
      }),
    )
    .filter((c) => c.firstName || c.lastName || c.email);
  if (companies.length) out.companies = companies;
  if (contacts.length) out.contacts = contacts;
  const properties = (Array.isArray(p.properties) ? p.properties : []).flatMap((r): PropertyRow[] => {
    const address = str(r.address, 200);
    if (!address) return [];
    const callResult = (AQ_STAGES as readonly string[]).includes(str(r.callResult, 40) ?? "") ? str(r.callResult, 40) : undefined;
    const stage = str(r.dealStage, 80);
    const guess = str(r.holdGuess, 20)?.toLowerCase();
    return [
      {
        address,
        parcelId: str(r.parcelId, 80),
        city: str(r.city, 120),
        state: str(r.state, 2)?.toUpperCase(),
        county: str(r.county, 80)?.replace(/\s+county$/i, ""),
        neighborhood: str(r.neighborhood, 120),
        businessName: str(r.businessName, 160),
        category: str(r.category, 120),
        assetType: (AQ_ASSET_TYPES as readonly string[]).includes(str(r.assetType, 80) ?? "") ? str(r.assetType, 80) : undefined,
        zoning: str(r.zoning, 60),
        acreage: num(r.acreage),
        squareFeet: int(r.squareFeet),
        yearBuilt: int(r.yearBuilt),
        units: int(r.units),
        lastSaleDate: isoDay(r.lastSaleDate),
        lastSalePrice: num(r.lastSalePrice),
        askingPrice: num(r.askingPrice),
        assessedValue: num(r.assessedValue),
        googleRating: num(r.googleRating) != null ? Math.min(5, Math.max(0, num(r.googleRating)!)) : undefined,
        reviewCount: int(r.reviewCount),
        reportUrl: url(str(r.reportUrl, 500)),
        sourceList: str(r.sourceList, 160),
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
        callResult,
        lastCallDate: isoDay(r.lastCallDate),
        callBackAt: callResult === "Callback" ? isoDay(r.callBackAt) : undefined,
        callNotes: str(r.callNotes, 4000),
        notesDated: dated(r.notesDated),
        transcripts: dated(r.transcripts),
        sendToPipeline: bool(r.sendToPipeline),
        deal: bool(r.deal),
        dealStage: stage && dealStages.includes(stage) ? stage : stage ? dealStages.find((s) => s.toLowerCase() === stage.toLowerCase()) : undefined,
        pipelinePriority: priority(r.pipelinePriority),
        junk: bool(r.junk),
        junkReason: str(r.junkReason, 200),
        notes: str(r.notes, 4000),
        companies: list(r.companies),
        contacts: list(r.contacts),
        owner: str(r.owner, 200),
        operator: str(r.operator, 200),
        hold: r.hold === true ? true : undefined,
        holdQuestion: str(r.holdQuestion, 1000),
        holdGuess: GUESSES.find((g) => g === guess),
      },
    ];
  });
  if (properties.length) out.properties = properties;
  return out;
}

// ---------- matching ----------

type ContactLite = { id: string; firstName: string | null; lastName: string | null; email: string | null; emails: string | null; phone: string | null; secondaryPhone: string | null; otherPhones: string | null; storePhone: string | null; companyId: string | null };
const CONTACT_LITE = { id: true, firstName: true, lastName: true, email: true, emails: true, phone: true, secondaryPhone: true, otherPhones: true, storePhone: true, companyId: true } as const;
const phonesOf = (c: ContactLite) => [c.phone, c.secondaryPhone, c.storePhone, ...lines(c.otherPhones)].map(normalizePhone).filter((d) => d.length >= 7);
const emailsOf = (c: ContactLite) => [c.email, ...lines(c.emails)].filter((x): x is string => Boolean(x)).map((e) => e.toLowerCase());

/** An existing person: by email, else by name plus a phone or an email they share, else by name at the same company, else the one person of that name with nothing else to go on. */
async function findContact(c: ContactRow, companyId: string | null): Promise<ContactLite | null> {
  const emails = [c.email, ...(c.emails ?? [])].filter((x): x is string => Boolean(x)).map((e) => e.toLowerCase());
  const phones = [c.phone, c.secondaryPhone, c.storePhone, c.directoryOperatorPhone, ...(c.otherPhones ?? [])].filter((x): x is string => Boolean(x)).map(normalizePhone).filter((d) => d.length >= 7);
  for (const e of emails) {
    const hit = await prisma.aqContact.findFirst({ where: { OR: [{ email: { equals: e, mode: ci } }, { emails: { contains: e, mode: ci } }] }, select: CONTACT_LITE });
    if (hit) return hit;
  }
  if (!c.firstName && !c.lastName) return null;
  const byName = await prisma.aqContact.findMany({ where: { firstName: { equals: c.firstName ?? "", mode: ci }, lastName: { equals: c.lastName ?? "", mode: ci } }, select: CONTACT_LITE, take: 50 });
  if (!byName.length) return null;
  const shares = byName.find((x) => phonesOf(x).some((d) => phones.includes(d)) || emailsOf(x).some((e) => emails.includes(e)));
  if (shares) return shares;
  const atCompany = companyId ? byName.find((x) => x.companyId === companyId) : null;
  if (atCompany) return atCompany;
  if (phones.length || emails.length) return byName.length === 1 && byName[0].phone == null && byName[0].email == null ? byName[0] : null;
  return byName.length === 1 ? byName[0] : null;
}

type PropertyLite = { id: string; address: string; city: string | null; parcelId: string | null; junkedAt: Date | null; junkReason: string | null; pipelineAt: Date | null; dealStage: string | null; stages: string; notes: string | null; lastCallDate: Date | null };
const PROPERTY_LITE = { id: true, address: true, city: true, parcelId: true, junkedAt: true, junkReason: true, pipelineAt: true, dealStage: true, stages: true, notes: true, lastCallDate: true } as const;

/** An existing property: by Parcel ID first, then by the normalized address and town. */
export async function findProperty(address: string, parcelId: string | undefined, city: string | undefined): Promise<PropertyLite | null> {
  if (parcelId) {
    const hit = await prisma.aqProperty.findFirst({ where: { parcelId: { equals: parcelId, mode: ci } }, select: PROPERTY_LITE });
    if (hit) return hit;
    const bare = parcelId.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (bare.length >= 5) {
      const near = await prisma.aqProperty.findMany({ where: { parcelId: { not: null } }, select: PROPERTY_LITE, take: 5000 });
      const hit2 = near.find((p) => (p.parcelId ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase() === bare);
      if (hit2) return hit2;
    }
  }
  const want = normalizeAddress(address);
  if (!want) return null;
  const number = want.split(" ")[0];
  const candidates = await prisma.aqProperty.findMany({ where: number && /\d/.test(number) ? { address: { contains: number } } : { address: { contains: address.split(/\s+/)[0] ?? address, mode: ci } }, select: PROPERTY_LITE, take: 500 });
  const town = normalizeTown(city);
  const same = candidates.filter((p) => normalizeAddress(p.address) === want);
  if (!same.length) return null;
  if (town) return same.find((p) => normalizeTown(p.city) === town) ?? same.find((p) => !p.city) ?? null;
  return same[0];
}

// ---------- holding ----------

const refsProperty = (ref: string, r: PropertyRow) => norm(ref) === norm(r.address) || normalizeAddress(ref) === normalizeAddress(r.address) || (Boolean(r.parcelId) && norm(ref) === norm(r.parcelId!));
const where = (r: PropertyRow) => `${r.address}${r.city ? `, ${r.city}` : ""}`;

/** Why a row cannot be written without Shawn: the assistant's own hold, two tags that pull apart, or a junk property an export wants back. */
function holdReason(r: PropertyRow, found: PropertyLite | null): { question: string; guess: HoldGuess } | null {
  if (r.hold) return { question: r.holdQuestion ?? `${where(r)}: the file did not settle what to do with this property.`, guess: r.holdGuess ?? (r.junk ? "junk" : r.deal ? "deal" : r.sendToPipeline ? "pipeline" : "live") };
  const wantsLive = r.deal === true || r.sendToPipeline === true || r.callResult === "Callback" || r.callResult === "Deal";
  if (r.junk === true && wantsLive) {
    const tags = [r.deal || r.callResult === "Deal" ? "Deal" : null, r.sendToPipeline ? "Pipeline" : null, r.callResult === "Callback" ? "Callback" : null].filter(Boolean).join(" and ");
    return { question: `${where(r)}: tagged ${tags} and also marked for removal${r.junkReason ? ` (${r.junkReason})` : ""}. The removal looks like the later word, so it should go to Junk. Please confirm.`, guess: r.holdGuess ?? "junk" };
  }
  if (found?.junkedAt && r.junk !== true && wantsLive) {
    const guess: HoldGuess = r.deal || r.callResult === "Deal" ? "deal" : r.sendToPipeline ? "pipeline" : "live";
    return { question: `${where(r)} is in Junk Properties${found.junkReason ? ` (${found.junkReason})` : ""}, and this file tags it ${r.deal || r.callResult === "Deal" ? "Deal" : r.sendToPipeline ? "Pipeline" : "Callback"}. Bring it back as ${guess === "deal" ? "an active deal" : guess === "pipeline" ? "a potential deal on the Deals Pipeline list" : "a live property"}? It stays in Junk until you say.`, guess };
  }
  return null;
}

/** Set a property aside: its row, the people tied only to it, its companies and its junk numbers, until Shawn answers. */
async function holdProperty(r: PropertyRow, found: PropertyLite | null, question: string, guess: HoldGuess, p: Proposal, heldContacts: Set<ContactRow>, heldJunk: Set<JunkPhoneRow>): Promise<WaitingItem> {
  const contacts = (p.contacts ?? []).filter((c) => {
    const refs = c.properties ?? [];
    const tied = refs.some((ref) => refsProperty(ref, r)) || [r.owner, r.operator, ...(r.contacts ?? [])].some((ref) => ref && (norm(ref) === norm([c.firstName, c.lastName].filter(Boolean).join(" ")) || (c.email && ref.toLowerCase() === c.email) || [c.phone, c.secondaryPhone, ...(c.otherPhones ?? [])].some((ph) => ph && normalizePhone(ph) === normalizePhone(ref))));
    const onlyHere = refs.every((ref) => refsProperty(ref, r));
    return tied && onlyHere;
  });
  for (const c of contacts) heldContacts.add(c);
  const junk = (p.junkPhones ?? []).filter((j) => j.property && refsProperty(j.property, r));
  for (const j of junk) heldJunk.add(j);
  const names = new Set([r.ownerEntity, r.operatorEntity, ...(r.companies ?? []), ...contacts.map((c) => c.company)].filter((x): x is string => Boolean(x)).map(norm));
  const companies = (p.companies ?? []).filter((c) => names.has(norm(c.name)));
  const { hold: _h, holdQuestion: _q, holdGuess: _g, ...row } = r;
  void _h; void _q; void _g;
  const payload: PendingPayload = { property: row, contacts, companies, junkPhones: junk };
  // the same property asked about twice: the newer file's rows replace the older question
  const dup = await prisma.aqPendingImport.findFirst({ where: { status: "PENDING", OR: [{ propertyId: found?.id ?? "~" }, { address: { equals: r.address, mode: ci }, city: r.city ?? null }] } });
  const data = { address: r.address, city: r.city ?? null, parcelId: r.parcelId ?? null, propertyId: found?.id ?? null, question, guess, payload: JSON.stringify(payload), sourceFile: p.sourceFile ?? null };
  const row2 = dup ? await prisma.aqPendingImport.update({ where: { id: dup.id }, data }) : await prisma.aqPendingImport.create({ data });
  return { id: row2.id, address: where(r), question, guess };
}

/** The dashboard's Waiting on Shawn list and the chat's lookup: every held property, oldest first, numbered. */
export async function waitingOnShawn(): Promise<(WaitingItem & { n: number; city: string | null; propertyId: string | null; sourceFile: string | null; createdAt: Date })[]> {
  const rows = await prisma.aqPendingImport.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  return rows.map((r, i) => ({ n: i + 1, id: r.id, address: `${r.address}${r.city ? `, ${r.city}` : ""}`, city: r.city, propertyId: r.propertyId, question: r.question, guess: GUESSES.find((g) => g === r.guess) ?? "live", sourceFile: r.sourceFile, createdAt: r.createdAt }));
}

export type ResolveAction = HoldGuess | "dismiss" | "confirm";
/**
 * Shawn's answer on a held property (from the chat or the dashboard): junk it, send it to the Deals Pipeline list,
 * make it an active deal, import it as a live property, or dismiss it (nothing written). The held rows are then
 * written through the same importer, with his answer applied.
 */
export async function resolvePendingImport(id: string, action: ResolveAction, extra: { dealStage?: string; junkReason?: string; answer?: string } = {}): Promise<{ ok: true; did: string; report?: AqImportReport } | { ok: false; reason: string }> {
  const row = await prisma.aqPendingImport.findUnique({ where: { id } });
  if (!row) return { ok: false, reason: "That held property is gone from the list." };
  if (row.status !== "PENDING") return { ok: false, reason: "That one was already answered." };
  const guess = GUESSES.find((g) => g === row.guess) ?? "live";
  const act: HoldGuess | "dismiss" = action === "confirm" ? guess : action;
  if (act === "dismiss") {
    await prisma.aqPendingImport.update({ where: { id }, data: { status: "DISMISSED", answer: extra.answer ?? "dismissed", resolvedAt: new Date() } });
    return { ok: true, did: `${row.address}: dismissed, nothing written` };
  }
  let payload: PendingPayload;
  try {
    payload = JSON.parse(row.payload) as PendingPayload;
  } catch {
    return { ok: false, reason: "The held rows could not be read." };
  }
  const r: PropertyRow = { ...payload.property, hold: undefined, holdQuestion: undefined, holdGuess: undefined };
  if (act === "junk") {
    r.junk = true;
    r.junkReason = extra.junkReason ?? r.junkReason ?? "removed on Shawn's say-so";
    r.deal = r.deal === true ? false : r.deal;
    r.sendToPipeline = r.sendToPipeline === true ? false : r.sendToPipeline;
    if (r.callResult === "Deal") r.callResult = undefined;
  } else {
    r.junk = false;
    if (act === "deal") {
      r.deal = true;
      r.dealStage = extra.dealStage ?? r.dealStage;
      r.sendToPipeline = undefined;
    } else if (act === "pipeline") {
      r.sendToPipeline = true;
      if (r.deal === true || r.callResult === "Deal") r.deal = false;
      if (r.callResult === "Deal") r.callResult = undefined;
    } else {
      if (r.deal === true || r.callResult === "Deal") r.deal = false;
      if (r.callResult === "Deal") r.callResult = undefined;
      if (r.sendToPipeline === true) r.sendToPipeline = undefined;
    }
  }
  const result = await runAqImport({ summary: `Held property answered: ${row.address}`, sourceFile: row.sourceFile ?? undefined, properties: [r], contacts: payload.contacts, companies: payload.companies, junkPhones: payload.junkPhones }, { noHold: true });
  await prisma.aqPendingImport.update({ where: { id }, data: { status: "DONE", answer: extra.answer ?? act, resolvedAt: new Date() } });
  const did = act === "junk" ? `${row.address}: moved to Junk Properties (${r.junkReason})` : act === "deal" ? `${row.address}: an active deal on the Deals board (${r.dealStage ?? "first stage"})` : act === "pipeline" ? `${row.address}: a potential deal on the Deals Pipeline list` : `${row.address}: imported as a live property`;
  return { ok: true, did, report: result.report };
}

// ---------- the import ----------

export async function runAqImport(p: Proposal, opts: { noHold?: boolean } = {}): Promise<ImportResult> {
  const report: AqImportReport = { properties: { new: 0, updated: 0, junked: 0, skipped: 0 }, contacts: { new: 0, updated: 0 }, companies: { new: 0, updated: 0 }, numbersJunked: 0, pipeline: [], callbacks: [], notes: 0, transcripts: 0, waiting: [], unsure: [...(p.unsure ?? [])] };
  const result: ImportResult = { created: { properties: 0, companies: 0, contacts: 0 }, matched: { properties: 0, companies: 0, contacts: 0 }, links: [], skipped: [], report };
  const link = (label: string, href: string) => {
    if (result.links.length < 60) result.links.push({ label, href });
  };
  const sourceFile = p.sourceFile;
  const dealStages = await getAqDealStages();
  const stageIndex = (s: string | null | undefined) => (s ? dealStages.indexOf(s) : -1);

  // ----- hold: the rows Shawn has to decide are set aside first, with the people and numbers that belong only to them -----
  const heldContacts = new Set<ContactRow>();
  const heldJunk = new Set<JunkPhoneRow>();
  const heldRows = new Set<PropertyRow>();
  const foundById = new Map<PropertyRow, PropertyLite | null>();
  for (const r of p.properties ?? []) {
    const found = await findProperty(r.address, r.parcelId, r.city);
    foundById.set(r, found);
    if (opts.noHold) continue;
    const why = holdReason(r, found);
    if (!why) continue;
    heldRows.add(r);
    report.waiting.push(await holdProperty(r, found, why.question, why.guess, p, heldContacts, heldJunk));
  }
  const properties = (p.properties ?? []).filter((r) => !heldRows.has(r));
  const contactsToWrite = (p.contacts ?? []).filter((c) => !heldContacts.has(c));

  // junk numbers never land on anyone: the list on file plus the ones this file marks
  const junkList: JunkPhoneRow[] = [...(p.junkPhones ?? []).filter((j) => !heldJunk.has(j)), ...contactsToWrite.flatMap((c) => (c.junkPhones ?? []).map((j) => ({ ...j, contact: j.contact ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || c.email) })))];
  const junk = await junkPhoneDigits();
  for (const j of [...junkList, ...heldJunk, ...[...heldContacts].flatMap((c) => c.junkPhones ?? [])]) junk.add(digitsOf(j.number));
  const ok = (v?: string) => (v && !junk.has(digitsOf(v)) ? v : undefined);
  const okList = (l?: string[]) => {
    const kept = l?.filter((x) => !junk.has(digitsOf(x)));
    return kept?.length ? kept : undefined;
  };

  // ----- companies -----
  const companyIds = new Map<string, string>(); // norm(name) → id
  const companyRows = new Map<string, CompanyRow>();
  for (const c of p.companies ?? []) companyRows.set(norm(c.name), c);
  for (const r of properties) for (const n of [...(r.companies ?? []), r.ownerEntity, r.operatorEntity]) if (n && !companyRows.has(norm(n))) companyRows.set(norm(n), { name: n });
  for (const c of contactsToWrite) if (c.company && !companyRows.has(norm(c.company))) companyRows.set(norm(c.company), { name: c.company, roles: c.roles });
  for (const c of companyRows.values()) {
    const found = await prisma.aqCompany.findFirst({ where: { name: { equals: c.name, mode: ci } } });
    const data = given({ website: c.website, domain: domainOfUrl(c.website) ?? undefined, phone: ok(c.phone), city: c.city, state: c.state });
    if (found) {
      await prisma.aqCompany.update({ where: { id: found.id }, data: { ...data, roles: c.roles?.length ? toJsonList([...parseJsonList(found.roles), ...c.roles]) : undefined, notes: c.notes && !(found.notes ?? "").includes(c.notes) ? [found.notes, c.notes].filter(Boolean).join("\n") : undefined } });
      companyIds.set(norm(c.name), found.id);
      report.companies.updated++;
      result.matched.companies++;
    } else {
      const made = await prisma.aqCompany.create({ data: { name: c.name, roles: toJsonList(c.roles ?? []), notes: c.notes, ...data } });
      companyIds.set(norm(c.name), made.id);
      report.companies.new++;
      result.created.companies++;
      link(c.name, `/acquisitions/companies/${made.id}`);
    }
  }

  // ----- people -----
  const contactIds = new Map<string, string>(); // email, norm(name), phone digits → id
  const contactName = new Map<string, string>(); // id → name
  const pendingLinks: { contactId: string; address: string }[] = [];
  for (const c of contactsToWrite) {
    const companyId = c.company ? companyIds.get(norm(c.company)) ?? null : null;
    const company = companyId ? await prisma.aqCompany.findUnique({ where: { id: companyId }, select: { roles: true } }) : null;
    const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
    const found = await findContact(c, companyId);
    const cur = found ? await prisma.aqContact.findUnique({ where: { id: found.id }, select: { roles: true, notes: true, pipelineAt: true, lastCallDate: true, callResult: true } }) : null;
    // a newer call on file is never overwritten by an older one (repeat exports)
    const newCall = day(c.lastCallDate);
    const staleCall = Boolean(cur?.lastCallDate && newCall && newCall.getTime() < cur.lastCallDate.getTime());
    const callBackAt = !staleCall && c.callResult === "Callback" ? day(c.callBackAt) : null;
    const followUpAt = staleCall ? null : day(c.followUpAt) ?? callBackAt;
    const base = given({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      emails: c.emails?.length ? c.emails.join("\n") : undefined,
      phone: ok(c.phone),
      secondaryPhone: ok(c.secondaryPhone),
      otherPhones: okList(c.otherPhones)?.join("\n"),
      mailingAddress: c.mailingAddress,
      companyId: companyId ?? undefined,
      operatorBrandName: c.operatorBrandName,
      website: c.website,
      operatorEntityName: c.operatorEntityName,
      directoryOperatorName: c.directoryOperatorName,
      storePhone: ok(c.storePhone),
      directoryOperatorPhone: ok(c.directoryOperatorPhone),
      operatorTotalLocations: c.operatorTotalLocations,
      operatorPipelineStatus: c.operatorPipelineStatus,
      lastCallDate: staleCall ? undefined : newCall ?? (c.callResult && c.callResult !== "Skipped" ? new Date() : undefined),
      callResult: staleCall ? undefined : c.callResult,
      callBackAt: callBackAt ?? undefined,
      followUpAt: followUpAt ?? undefined,
      pipelinePriority: c.pipelinePriority,
    });
    const pipelineData = c.sendToPipeline === true ? { pipelineAt: cur?.pipelineAt ?? new Date() } : c.sendToPipeline === false ? { pipelineAt: null, pipelinePriority: null } : {};
    let contactId: string;
    if (found) {
      await prisma.aqContact.update({
        where: { id: found.id },
        data: {
          ...base,
          ...pipelineData,
          ...(callBackAt ? { callBackDismissedAt: null } : {}),
          roles: mergeAqRoles(toJsonList([...parseJsonList(cur?.roles), ...(c.roles ?? [])]), company?.roles),
          notes: c.notes && !(cur?.notes ?? "").includes(c.notes) ? [cur?.notes, c.notes].filter(Boolean).join("\n") : undefined,
        },
      });
      contactId = found.id;
      report.contacts.updated++;
      result.matched.contacts++;
      if (staleCall) report.unsure.push(`${fullName || c.email}: the file's call (${c.lastCallDate}) is older than the one on the card (${cur?.lastCallDate?.toISOString().slice(0, 10)}); the card's result was kept`);
    } else {
      const made = await prisma.aqContact.create({ data: { ...base, ...pipelineData, roles: mergeAqRoles(toJsonList(c.roles ?? []), company?.roles), notes: c.notes } });
      contactId = made.id;
      report.contacts.new++;
      result.created.contacts++;
      link(fullName || c.email || "Contact", `/acquisitions/contacts/${made.id}`);
    }
    if (c.sendToPipeline === true && !cur?.pipelineAt) report.pipeline.push(`${fullName || c.email}: onto the ${c.roles?.includes("Buyer") ? "Buyers" : "Operators"} Pipeline${c.pipelinePriority ? ` (priority ${c.pipelinePriority})` : ""}`);
    if (callBackAt) report.callbacks.push(`${fullName || c.email}: call back ${(followUpAt ?? callBackAt).toISOString().slice(0, 10)}`);
    contactName.set(contactId, fullName || c.email || "Contact");
    if (c.email) contactIds.set(c.email.toLowerCase(), contactId);
    if (fullName) contactIds.set(norm(fullName), contactId);
    for (const ph of [c.phone, c.secondaryPhone, ...(c.otherPhones ?? [])]) if (ph) contactIds.set(normalizePhone(ph), contactId);
    // dated history: each note and transcript its own entry, never the same text on the same day twice
    const noteRows: DatedText[] = [...(c.callNotes ? [{ text: c.callNotes, date: c.lastCallDate }] : []), ...(c.notesDated ?? [])];
    report.notes += await addDated("note", { contactId }, noteRows);
    report.transcripts += await addDated("transcript", { contactId }, c.transcripts ?? []);
    for (const addr of c.properties ?? []) pendingLinks.push({ contactId, address: addr });
  }

  // ----- properties -----
  const propertyIds = new Map<string, string>(); // norm(address), normalizeAddress(address), parcel → id
  const keyOf = (r: PropertyRow) => [norm(r.address), normalizeAddress(r.address), r.parcelId ? `parcel:${r.parcelId.toLowerCase()}` : null].filter((x): x is string => Boolean(x));
  const resolveContact = (ref: string | undefined) => (ref ? contactIds.get(ref.toLowerCase()) ?? contactIds.get(norm(ref)) ?? contactIds.get(normalizePhone(ref)) : undefined);
  const findPropertyRef = async (ref: string) => propertyIds.get(norm(ref)) ?? propertyIds.get(normalizeAddress(ref)) ?? propertyIds.get(`parcel:${ref.toLowerCase()}`) ?? (await findProperty(ref, ref, undefined))?.id;
  for (const r of properties) {
    const found = foundById.get(r) ?? null;
    const wasDeal = found ? parseJsonList(found.stages).includes("Deal") : false;
    const newCall = day(r.lastCallDate);
    const staleCall = Boolean(found?.lastCallDate && newCall && newCall.getTime() < found.lastCallDate.getTime());
    const callResult = staleCall ? undefined : r.callResult;
    const callBackAt = callResult === "Callback" ? day(r.callBackAt) : undefined;
    // the two deal lists (Jonathan, Oct 5, 2026): deal true (or the Deal result, or a stage) ticks Deal, an active deal on the
    // Deals board, off the Deals Pipeline list; deal false sends an active deal back to potential; sendToPipeline puts a
    // potential deal on the Deals Pipeline list (false takes it off). A deal is never moved backward on the board by a file.
    const deal = r.deal === true || callResult === "Deal" || Boolean(r.dealStage) ? true : r.deal === false ? false : undefined;
    const otherResult = callResult && callResult !== "Deal" ? callResult : undefined;
    const stages = deal === true ? ["Deal"] : otherResult ? [otherResult] : deal === false ? [] : undefined;
    const toPipeline = r.sendToPipeline === true || (deal === false && wasDeal && r.sendToPipeline !== false);
    const wantStage = deal === true ? r.dealStage ?? found?.dealStage ?? dealStages[0] : undefined;
    const dealStage = deal === true ? (wasDeal && stageIndex(found?.dealStage) > stageIndex(wantStage) ? found!.dealStage! : wantStage) : deal === false || otherResult ? null : undefined;
    const data = given({
      parcelId: r.parcelId,
      city: r.city,
      state: r.state,
      county: r.county,
      neighborhood: r.neighborhood,
      businessName: r.businessName,
      category: r.category,
      assetType: r.assetType,
      zoning: r.zoning,
      acreage: r.acreage,
      squareFeet: r.squareFeet,
      yearBuilt: r.yearBuilt,
      units: r.units,
      lastSaleDate: day(r.lastSaleDate) ?? undefined,
      lastSalePrice: r.lastSalePrice,
      askingPrice: r.askingPrice,
      assessedValue: r.assessedValue,
      googleRating: r.googleRating,
      reviewCount: r.reviewCount,
      reportUrl: r.reportUrl,
      sourceList: r.sourceList ?? sourceFile,
      ownerEntity: r.ownerEntity,
      ownerName: r.ownerName,
      primaryPhone: ok(r.primaryPhone),
      secondaryPhone: ok(r.secondaryPhone),
      otherPhones: okList(r.otherPhones)?.join("\n"),
      primaryEmail: r.primaryEmail,
      emails: r.emails?.length ? r.emails.join("\n") : undefined,
      ownerMailingAddress: r.ownerMailingAddress,
      operatorEntity: r.operatorEntity,
      operatorName: r.operatorName,
      operatorPhone: ok(r.operatorPhone),
      operatorEmail: r.operatorEmail,
      stages: stages ? JSON.stringify(stages) : undefined,
      lastCallDate: staleCall ? undefined : newCall ?? (callResult && callResult !== "Skipped" ? new Date() : undefined),
      callBackAt: callBackAt ?? undefined,
      followUpAt: callBackAt ?? undefined,
      dealStage: dealStage === null ? undefined : dealStage,
      pipelinePriority: r.pipelinePriority,
    });
    const listData = deal === true ? { pipelineAt: null, pipelinePriority: null } : toPipeline ? { pipelineAt: found?.pipelineAt ?? new Date() } : r.sendToPipeline === false ? { pipelineAt: null, pipelinePriority: null } : {};
    // a junk property stays in Junk unless the file says otherwise (which the hold step asks about); junk false restores it
    const restore = found?.junkedAt && r.junk === false ? { junkedAt: null, junkedBy: null, junkReason: null, junkSource: null } : {};
    let id: string;
    if (found) {
      await prisma.aqProperty.update({
        where: { id: found.id },
        data: { ...data, ...listData, ...restore, ...(dealStage === null ? { dealStage: null } : {}), ...(callBackAt ? { callBackDismissedAt: null } : {}), notes: r.notes && !(found.notes ?? "").includes(r.notes) ? [found.notes, r.notes].filter(Boolean).join("\n") : undefined },
      });
      id = found.id;
      report.properties.updated++;
      result.matched.properties++;
      if (found.junkedAt && r.junk === false) report.pipeline.push(`${r.address}: restored from Junk Properties`);
      if (deal === true && !wasDeal) report.pipeline.push(`${r.address}: now an active deal on the Deals board (${dealStage})`);
      else if (deal === true && r.dealStage && dealStage !== found.dealStage) report.pipeline.push(`${r.address}: deal stage ${dealStage}`);
      else if (deal === true && r.dealStage && r.dealStage !== dealStage) report.unsure.push(`${r.address}: the file says stage ${r.dealStage}, but the deal is already at ${found.dealStage}; it was not moved backward`);
      else if (deal === false && wasDeal) report.pipeline.push(toPipeline ? `${r.address}: back to a potential deal on the Deals Pipeline list` : `${r.address}: off the Deals board, a normal live property`);
      else if (toPipeline && !found.pipelineAt) report.pipeline.push(`${r.address}: onto the Deals Pipeline list${r.pipelinePriority ? ` (priority ${r.pipelinePriority})` : ""}`);
      else if (r.sendToPipeline === false && found.pipelineAt) report.pipeline.push(`${r.address}: off the Deals Pipeline list`);
      if (staleCall) report.unsure.push(`${r.address}: the file's call (${r.lastCallDate}) is older than the one on the ticket; the ticket's result was kept`);
    } else {
      const made = await prisma.aqProperty.create({ data: { address: r.address, notes: r.notes, ...data, ...listData } });
      id = made.id;
      report.properties.new++;
      result.created.properties++;
      link(r.address, `/acquisitions/properties/${made.id}`);
      if (deal === true) report.pipeline.push(`${r.address}: an active deal on the Deals board (${dealStage})`);
      else if (toPipeline) report.pipeline.push(`${r.address}: onto the Deals Pipeline list${r.pipelinePriority ? ` (priority ${r.pipelinePriority})` : ""}`);
    }
    if (callResult === "Skipped") report.properties.skipped++;
    if (callBackAt) report.callbacks.push(`${r.address}: call back ${callBackAt.toISOString().slice(0, 10)}`);
    for (const k of keyOf(r)) propertyIds.set(k, id);
    const noteRows: DatedText[] = [...(r.callNotes ? [{ text: r.callNotes, date: r.lastCallDate }] : []), ...(r.notesDated ?? [])];
    report.notes += await addDated("note", { propertyId: id }, noteRows);
    report.transcripts += await addDated("transcript", { propertyId: id }, r.transcripts ?? []);
    for (const n of [...(r.companies ?? []), r.ownerEntity, r.operatorEntity]) {
      const companyId = n ? companyIds.get(norm(n)) : undefined;
      if (companyId) await prisma.aqPropertyCompany.upsert({ where: { propertyId_companyId: { propertyId: id, companyId } }, create: { propertyId: id, companyId }, update: {} });
    }
    for (const ref of [...(r.contacts ?? []), r.owner, r.operator]) {
      if (!ref) continue;
      const contactId = resolveContact(ref) ?? (await findContactByRef(ref));
      if (contactId) await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId: id, contactId } }, create: { propertyId: id, contactId }, update: {} });
      else result.skipped.push(`${r.address}: no contact called ${ref} in this import or the CRM`);
    }
    // the owner and operator named only on the property row: a contact card each
    if (!r.owner && !(r.contacts ?? []).length && (r.ownerName || r.primaryPhone)) await ensurePersonFromProperty(id, "Owner", r.ownerName, r.ownerEntity, [r.primaryPhone, r.secondaryPhone, ...(r.otherPhones ?? [])].map(ok), r.primaryEmail, r.ownerMailingAddress, companyIds, contactIds, report);
    if (!r.operator && (r.operatorName || r.operatorPhone)) await ensurePersonFromProperty(id, "Operator", r.operatorName, r.operatorEntity, [ok(r.operatorPhone)], r.operatorEmail, undefined, companyIds, contactIds, report);
  }
  for (const l of pendingLinks) {
    const held = [...heldRows].some((r) => refsProperty(l.address, r));
    if (held) continue; // the link waits with the held property
    const propertyId = await findPropertyRef(l.address);
    if (propertyId) await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId, contactId: l.contactId } }, create: { propertyId, contactId: l.contactId }, update: {} });
    else result.skipped.push(`No property at ${l.address} to tie ${contactName.get(l.contactId) ?? "the contact"} to`);
  }
  // company ↔ contact and company ↔ property links named on company rows
  for (const c of p.companies ?? []) {
    const companyId = companyIds.get(norm(c.name));
    if (!companyId) continue;
    for (const ref of c.contacts ?? []) {
      const contactId = resolveContact(ref) ?? (await findContactByRef(ref));
      if (contactId) await prisma.aqContact.update({ where: { id: contactId }, data: { companyId } });
    }
    for (const ref of c.properties ?? []) {
      if ([...heldRows].some((r) => refsProperty(ref, r))) continue;
      const propertyId = await findPropertyRef(ref);
      if (propertyId) await prisma.aqPropertyCompany.upsert({ where: { propertyId_companyId: { propertyId, companyId } }, create: { propertyId, companyId }, update: {} });
    }
  }

  // ----- junk numbers: off everyone, tied to the person and the property they came from -----
  for (const j of junkList) {
    const contactId = resolveContact(j.contact) ?? (j.contact ? await findContactByRef(j.contact) : undefined) ?? contactIds.get(normalizePhone(j.number));
    const propertyId = (j.property ? await findPropertyRef(j.property) : undefined) ?? (contactId ? (await prisma.aqPropertyContact.findFirst({ where: { contactId }, select: { propertyId: true } }))?.propertyId : undefined);
    const row = await addJunkPhone(j.number, { contactId: contactId ?? null, contactName: contactId ? contactName.get(contactId) ?? null : j.contact ?? null, propertyId: propertyId ?? null, field: "import", reason: j.reason ?? "marked junk in the imported file", sourceFile: sourceFile ?? null });
    if (row) report.numbersJunked++;
  }

  // ----- junk properties: filed under Junk Properties with the reason and the file -----
  for (const r of properties) {
    if (r.junk !== true) continue;
    const id = propertyIds.get(norm(r.address));
    if (!id) continue;
    const cur = await prisma.aqProperty.findUnique({ where: { id }, select: { junkedAt: true } });
    if (cur?.junkedAt) continue;
    await prisma.aqProperty.update({ where: { id }, data: { junkedAt: new Date(), junkedBy: "import", junkReason: r.junkReason ?? "marked junk in the imported file", junkSource: sourceFile ?? r.sourceList ?? null, pipelineAt: null, pipelinePriority: null } });
    report.properties.junked++;
  }
  report.unsure.push(...result.skipped);
  return result;
}

/** A contact named by email, "First Last" or a phone number that is already in the CRM. */
async function findContactByRef(ref: string): Promise<string | undefined> {
  const t = ref.trim();
  if (!t) return undefined;
  if (t.includes("@")) return (await prisma.aqContact.findFirst({ where: { email: { equals: t, mode: ci } }, select: { id: true } }))?.id;
  const digits = normalizePhone(t);
  if (digits.length >= 7 && /^[\d\s()+.-]+$/.test(t)) {
    const hit = await prisma.aqContact.findFirst({ where: { OR: [{ phone: { contains: digits.slice(-7) } }, { secondaryPhone: { contains: digits.slice(-7) } }, { otherPhones: { contains: digits.slice(-7) } }] }, select: { id: true } });
    return hit?.id;
  }
  const parts = t.split(/\s+/);
  if (parts.length < 2) return undefined;
  const hits = await prisma.aqContact.findMany({ where: { firstName: { equals: parts[0], mode: ci }, lastName: { equals: parts.slice(1).join(" "), mode: ci } }, select: { id: true }, take: 2 });
  return hits.length === 1 ? hits[0].id : undefined;
}

/** A note or a transcript per entry, dated as the file says (noon that day); the same text on the same day is not added twice. */
async function addDated(kind: "note" | "transcript", target: { contactId?: string; propertyId?: string }, rows: DatedText[]): Promise<number> {
  let added = 0;
  if (!rows.length) return 0;
  const where = target.contactId ? { contactId: target.contactId } : { propertyId: target.propertyId };
  const existing = kind === "note" ? await prisma.aqNote.findMany({ where, select: { body: true, createdAt: true } }) : await prisma.aqTranscript.findMany({ where, select: { body: true, createdAt: true } });
  for (const r of rows) {
    const text = r.text.trim();
    if (!text) continue;
    const when = day(r.date) ?? new Date();
    if (existing.some((e) => sameText(e.body, text) && (r.date ? sameDay(e.createdAt, when) : true))) continue;
    if (kind === "note") await prisma.aqNote.create({ data: { body: text, createdAt: when, ...where } });
    else await prisma.aqTranscript.create({ data: { body: text, createdAt: when, ...where } });
    existing.push({ body: text, createdAt: when });
    added++;
  }
  return added;
}

/** The owner or operator named only on a property row becomes a contact card linked to it (or is matched to one already there). */
async function ensurePersonFromProperty(propertyId: string, role: "Owner" | "Operator", name: string | undefined, entity: string | undefined, phones: (string | undefined)[], email: string | undefined, mailing: string | undefined, companyIds: Map<string, string>, contactIds: Map<string, string>, report: AqImportReport) {
  const nums = phones.filter((x): x is string => Boolean(x));
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const row: ContactRow = { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined, email, phone: nums[0], secondaryPhone: nums[1], otherPhones: nums.slice(2).length ? nums.slice(2) : undefined, mailingAddress: mailing, roles: [role], company: entity };
  if (!row.firstName && !row.email && !row.phone) return;
  const companyId = entity ? companyIds.get(norm(entity)) ?? null : null;
  const found = (row.firstName || row.email ? await findContact(row, companyId) : null) ?? (nums[0] ? await prisma.aqContact.findFirst({ where: { OR: [{ phone: { contains: normalizePhone(nums[0]).slice(-7) } }, { secondaryPhone: { contains: normalizePhone(nums[0]).slice(-7) } }] }, select: CONTACT_LITE }) : null);
  let contactId: string;
  if (found) {
    const cur = await prisma.aqContact.findUnique({ where: { id: found.id }, select: { roles: true } });
    await prisma.aqContact.update({ where: { id: found.id }, data: { roles: toJsonList([...parseJsonList(cur?.roles), role]), ...given({ companyId: companyId ?? undefined, mailingAddress: mailing, email: found.email ? undefined : email }) } });
    contactId = found.id;
    report.contacts.updated++;
  } else {
    const made = await prisma.aqContact.create({ data: { firstName: row.firstName ?? null, lastName: row.lastName ?? null, email: row.email ?? null, phone: row.phone ?? null, secondaryPhone: row.secondaryPhone ?? null, otherPhones: row.otherPhones?.join("\n") ?? null, mailingAddress: mailing ?? null, companyId, roles: toJsonList([role]) } });
    contactId = made.id;
    report.contacts.new++;
  }
  if (name) contactIds.set(norm(name), contactId);
  for (const n of nums) contactIds.set(normalizePhone(n), contactId);
  await prisma.aqPropertyContact.upsert({ where: { propertyId_contactId: { propertyId, contactId } }, create: { propertyId, contactId }, update: {} });
}
