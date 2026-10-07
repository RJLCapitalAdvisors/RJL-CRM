import * as XLSX from "xlsx";
import { digitsOf, ensureLlc, normalizeAddress, normalizePhone, normalizeTown } from "@/lib/acquisitions";

/**
 * Terakotta call exports, read by code (Oct 7, 2026). Ask the CRM used to hand the whole CSV to Claude and have it
 * retype every property: a 793-row export is 650k characters, so it was clipped at 350k, Claude never saw half the
 * file and 69 of 142 properties never came in. Here the file is read whole, every phone row is folded into its
 * property (Parcel ID, then street address + town; "Brick" = "Brick Township" = "Brick Township, NJ 08723"), the
 * property facts and the people are mapped by column name, and only the calls (tags, notes, transcripts) are left
 * for Claude to judge, a few properties at a time (aq-import-read.ts). Shawn's Import instructions are the spec.
 */

export type CallNote = { date?: string; text: string };
export type PhoneRow = {
  row: number; // 1-based line in the file (header is line 1)
  number: string;
  digits: string;
  slot: string; // T Phone 1..5, Owner Contact 1..3 Phone, Store Phone
  person: string | null; // key of the person the number belongs to (null: the business, a Store Phone)
  lineType?: string; // M (mobile) / L (landline) for T Phone slots
  disposition?: string;
  lastCall?: string; // ISO datetime
  tags: string[];
  notes: CallNote[];
  transcript?: string;
};
export type Person = { key: string; name: string; unconfirmed: boolean; source: string; emails: string[]; mailingAddress?: string };
export type PropertyFacts = {
  address: string; city?: string; state?: string; parcelId?: string; businessName?: string; category?: string; assetType?: string; zoning?: string;
  acreage?: number; squareFeet?: number; yearBuilt?: number; lastSaleDate?: string; lastSalePrice?: number; assessedValue?: number; googleRating?: number; reviewCount?: number; reportUrl?: string; notes?: string;
  ownerEntity?: string;
};
export type PropertyGroup = { key: string; facts: PropertyFacts; people: Person[]; phones: PhoneRow[]; rows: number[]; addresses: string[] };
export type ParsedFile = { format: "terakotta"; rowCount: number; ignored: { row: number; why: string }[]; groups: PropertyGroup[] };

// ---------- reading the file ----------

type Raw = Record<string, string>;

/** Every row of the first sheet as text, keyed by header. A CSV is decoded as UTF-8 first (read as bytes, "—" came out as "â€”"). */
export function readRows(name: string, buf: Buffer): Raw[] {
  const csv = /\.(csv|tsv|txt)$/i.test(name);
  const wb = csv ? XLSX.read(buf.toString("utf8").replace(/^﻿/, ""), { type: "string", raw: true }) : XLSX.read(buf, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "").trim()])));
}

/** Columns are found by name, never by position (Shawn: columns are added, removed or reordered between exports). */
function picker(headers: string[]) {
  const map = new Map(headers.map((h) => [h.toLowerCase().replace(/\s+/g, " ").trim(), h]));
  return (r: Raw, ...names: string[]) => {
    for (const n of names) {
      const h = map.get(n.toLowerCase());
      const v = h ? r[h] : undefined;
      if (v && v !== "-") return v;
    }
    return undefined;
  };
}

export const isTerakotta = (headers: string[]) => {
  const h = new Set(headers.map((x) => x.toLowerCase()));
  return h.has("phone number") && h.has("phone type") && h.has("street address") && headers.some((x) => /^tk_/i.test(x));
};

// ---------- values ----------

const num = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};
const pos = (v: string | undefined) => {
  const n = num(v);
  return n != null && n > 0 ? n : undefined;
};
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** "Sep 03, 2026 01:38PM" → an ISO datetime (local wall time kept as written). */
export function tkDate(v: string | undefined): string | undefined {
  const m = v?.match(/([A-Za-z]{3})\w* (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ?([AP]M))?/i);
  if (!m) return undefined;
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo == null) return undefined;
  let h = Number(m[4] ?? 12);
  if (m[6]) h = (h % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${m[3]}-${p(mo + 1)}-${p(Number(m[2]))}T${p(h)}:${m[5] ?? "00"}:00`;
}
/** "8/4/2009", "2009-08-04" or an Excel serial (Export: Deed Recorded) → yyyy-mm-dd. */
function anyDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
/** TK_NOTES: "[text - Sep 03, 2026 04:45PM] [more - …]", each its own dated note. */
export function tkNotes(v: string | undefined): CallNote[] {
  if (!v) return [];
  const out: CallNote[] = [];
  const re = /\[([\s\S]*?) - ([A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} ?[AP]M)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) if (m[1].trim()) out.push({ text: m[1].trim(), date: tkDate(m[2]) });
  if (!out.length && v.replace(/[[\]]/g, "").trim()) out.push({ text: v.replace(/^\[|\]$/g, "").trim() });
  return out;
}
export const tkTags = (v: string | undefined) => [...new Set((v?.match(/\[([^\]]+)\]/g) ?? []).map((t) => t.slice(1, -1).trim()).filter(Boolean))];
const ASSET: Record<string, string> = { freestanding: "Free-standing", "free-standing": "Free-standing", "shopping center / multi-tenant": "Strip center" };
const cityState = (v: string | undefined) => {
  const t = (v ?? "").replace(/\s*\b\d{5}(-\d{4})?\b\s*$/, "").trim();
  const m = t.match(/^(.*?),\s*([A-Za-z]{2})$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: t || undefined, state: undefined };
};
const personKey = (name: string) => name.replace(/\?/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const cleanName = (name: string) => name.replace(/\?/g, "").replace(/\s+/g, " ").trim();
const lineTypes = (v: string | undefined) => (v ?? "").split("/").map((x) => x.trim());

// ---------- folding rows into properties ----------

export function parseTerakotta(name: string, buf: Buffer): ParsedFile | { error: string } {
  const rows = readRows(name, buf);
  if (!rows.length) return { error: "The file has no rows." };
  const headers = Object.keys(rows[0]);
  if (!isTerakotta(headers)) return { error: "This does not look like a Terakotta call export (it needs Phone Number, Phone Type, Street Address and the TK_ columns). Other files still go through Ask the CRM." };
  const get = picker(headers);
  const ignored: { row: number; why: string }[] = [];

  // union-find over the rows: the same parcel, or the same street address in the same town, is one property
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const seen = new Map<string, number>();
  const keep: number[] = [];
  rows.forEach((r, i) => {
    const street = get(r, "Street Address");
    if (!street) return void ignored.push({ row: i + 2, why: "no street address" });
    keep.push(i);
    const parcel = get(r, "Parcel ID")?.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const addr = `a:${normalizeAddress(street)}|${normalizeTown(cityState(get(r, "City, State")).city)}`;
    for (const k of [parcel && parcel.length >= 3 ? `p:${parcel}` : null, addr]) {
      if (!k) continue;
      const at = seen.get(k);
      if (at == null) seen.set(k, i);
      else join(at, i);
    }
  });
  const byRoot = new Map<number, number[]>();
  for (const i of keep) {
    const root = find(i);
    const list = byRoot.get(root);
    if (list) list.push(i);
    else byRoot.set(root, [i]);
  }

  const groups: PropertyGroup[] = [];
  for (const idx of byRoot.values()) {
    const rs = idx.map((i) => rows[i]);
    const first = (...names: string[]) => rs.map((r) => get(r, ...names)).find(Boolean);
    // the street address written most often wins (Shawn: keep the correct street address)
    const counts = new Map<string, number>();
    for (const r of rs) {
      const s = get(r, "Street Address")!;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const addresses = [...counts.keys()];
    const address = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const { city, state } = cityState(first("City, State"));
    const lender = first("Export: Lender");
    const mortgage = pos(first("Export: Mortgage Amt"));
    const sources = first("Source(s)");
    const facts: PropertyFacts = {
      address,
      city,
      state,
      parcelId: first("Parcel ID"),
      businessName: first("Business Name(s)"),
      category: first("Type / Category"),
      assetType: ASSET[(first("Asset type") ?? "").toLowerCase()] ?? (first("Asset type") ? "Other" : undefined),
      zoning: first("Export: Zoning"),
      acreage: pos(first("Acreage")),
      squareFeet: pos(first("Gross SF")),
      yearBuilt: pos(first("Year Built")) ?? pos(first("Export: Year built")),
      lastSaleDate: anyDate(first("Last Sale Date")) ?? anyDate(first("Export: Deed Recorded")),
      lastSalePrice: pos(first("Last Sale Price")) ?? pos(first("Export: Deed Amnt")),
      assessedValue: pos(first("Assessed Value")),
      googleRating: pos(first("Rating")),
      reviewCount: pos(first("# Reviews")),
      reportUrl: first("Property Report"),
      ownerEntity: ensureLlc(first("Property Owner(s)")) ?? undefined,
      notes: [sources ? `Sources: ${sources}` : null, lender && mortgage ? `Current lender: ${lender}, mortgage $${Math.round(mortgage).toLocaleString("en-US")}` : null].filter(Boolean).join("\n") || undefined,
    };
    if (facts.yearBuilt) facts.yearBuilt = Math.round(facts.yearBuilt);
    if (facts.squareFeet) facts.squareFeet = Math.round(facts.squareFeet);

    // the people: T Contact Name is the main owner, Owner Contact 1/2/3 the others; the same person in two columns is one
    const people = new Map<string, Person>();
    const addPerson = (raw: string | undefined, source: string, email?: string, mailing?: string) => {
      if (!raw) return null;
      const key = personKey(raw);
      if (!key) return null;
      const cur = people.get(key);
      if (cur) {
        if (email && !cur.emails.includes(email.toLowerCase())) cur.emails.push(email.toLowerCase());
        if (mailing && !cur.mailingAddress) cur.mailingAddress = mailing;
        return key;
      }
      people.set(key, { key, name: cleanName(raw), unconfirmed: raw.includes("?"), source, emails: email ? [email.toLowerCase()] : [], mailingAddress: mailing });
      return key;
    };
    for (const r of rs) {
      addPerson(get(r, "T Contact Name"), "T Contact Name", get(r, "T Email"), get(r, "T Owner Mailing Address"));
      for (const n of [1, 2, 3]) addPerson(get(r, `Owner Contact ${n} Name`), `Owner Contact ${n}`, get(r, `Owner Contact ${n} Email`));
    }

    const phones: PhoneRow[] = [];
    for (const i of idx) {
      const r = rows[i];
      const slot = get(r, "Phone Type") ?? "";
      // Export: DeedPrcPerSqft / MtgPrcPerSqft rows are a leaked column, not a phone: the property still counts, the "number" does not
      if (/^export:/i.test(slot)) {
        ignored.push({ row: i + 2, why: `${slot} is a leaked column, not a phone number` });
        continue;
      }
      const number = get(r, "Phone Number");
      if (!number || digitsOf(number).length < 7) {
        if (number || get(r, "TK_DISPOSITION")) ignored.push({ row: i + 2, why: `no usable phone number on ${address}` });
        continue;
      }
      const tSlot = slot.match(/^T Phone (\d)/i);
      const oSlot = slot.match(/^Owner Contact (\d) Phone/i);
      const person = tSlot ? personKey(get(r, "T Contact Name") ?? "") || null : oSlot ? personKey(get(r, `Owner Contact ${oSlot[1]} Name`) ?? "") || null : null;
      const lt = tSlot ? lineTypes(get(r, "T Phone Types"))[Number(tSlot[1]) - 1] : undefined;
      const digits = normalizePhone(number);
      const dup = phones.find((p) => p.digits === digits);
      const call = { disposition: get(r, "TK_DISPOSITION"), lastCall: tkDate(get(r, "TK_LAST_CALL")), tags: tkTags(get(r, "TK_TAGS")), notes: tkNotes(get(r, "TK_NOTES")), transcript: get(r, "TK_TRANSCRIPT") };
      if (dup) {
        // the same number twice on one property (owner and store): one line, every call kept
        dup.tags = [...new Set([...dup.tags, ...call.tags])];
        dup.notes.push(...call.notes);
        if (call.transcript && call.transcript !== dup.transcript) dup.transcript = [dup.transcript, call.transcript].filter(Boolean).join("\n\n");
        if (call.lastCall && (!dup.lastCall || call.lastCall > dup.lastCall)) Object.assign(dup, { lastCall: call.lastCall, disposition: call.disposition ?? dup.disposition });
        dup.person ??= person;
        continue;
      }
      phones.push({ row: i + 2, number, digits, slot, person, lineType: lt && lt !== "-" ? lt : undefined, ...call });
    }
    const key = facts.parcelId ? `p:${facts.parcelId.replace(/[^a-z0-9]/gi, "").toLowerCase()}` : `a:${normalizeAddress(address)}|${normalizeTown(city)}`;
    groups.push({ key, facts, people: [...people.values()], phones, rows: idx.map((i) => i + 2), addresses });
  }
  groups.sort((a, b) => a.rows[0] - b.rows[0]);
  return { format: "terakotta", rowCount: rows.length, ignored, groups };
}

// ---------- what the file itself says (no judgment needed) ----------

export const isBadNumber = (p: PhoneRow) => /bad number/i.test(p.disposition ?? "") || p.tags.some((t) => /^wrong number$/i.test(t));
export const dialed = (p: PhoneRow) => Boolean(p.disposition || p.lastCall);
export const lastCallOf = (g: PropertyGroup) => g.phones.map((p) => p.lastCall).filter((x): x is string => Boolean(x)).sort().at(-1);
export const tagsOf = (g: PropertyGroup) => [...new Set(g.phones.flatMap((p) => p.tags))].filter((t) => !/push to hubspot/i.test(t));
