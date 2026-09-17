import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, graphConfigured, realmFor } from "@/lib/graph";
import { attachmentToText, emailHtmlToText } from "@/lib/attachments";
import { IL_MACHSAN_LOCATIONS, IL_PARKING, IL_REQUIRED, isCustomKey, nis, parseExtra, pricePerMeter, sqm } from "@/lib/israel";
import { loadIlRequired } from "@/lib/required-items";
import { stripDashes } from "@/lib/style";

/**
 * Apartments arriving by message: the deals@rjlisrael mailbox and the RJL Israel WhatsApp number. Whatever the
 * channel, the message and its files (Hebrew or English, PDFs, spreadsheets, photos of listings) are read, every
 * distinct apartment becomes its own ticket with what the documents state, project, developer and agent are linked,
 * and the sender gets back the tickets and what is still missing on each. Tickets with data missing wait under
 * Deals to be approved. Each message is handled once (IlInbound.messageId).
 */
export const ISRAEL_MAILBOX = () => process.env.ISRAEL_DEALS_MAILBOX ?? "deals@rjlisrael.com";
const INTERNAL = /@(rjlcapadvisors|rjlequities|rjlisrael)\.com$/i;
const q = (s: string) => encodeURIComponent(s);
type Msg = { id: string; internetMessageId?: string; subject: string | null; receivedDateTime: string; hasAttachments?: boolean; from?: { emailAddress: { address: string; name?: string } }; body?: { contentType: string; content: string } };
type Att = { "@odata.type": string; id: string; name: string; contentType: string | null; size: number; isInline: boolean };

const Direction = z.enum(["North", "South", "East", "West"]);
const Apartment = z.object({
  kind: z.enum(["apartment", "house"]).default("apartment").describe("house: a private house on its own plot (בית פרטי, וילה, קוטג', דו משפחתי, צמוד קרקע, בית קרקע). Everything in a building, including a duplex, penthouse or garden apartment, is an apartment."),
  name: z.string().describe("Short name in English: project or street plus apartment number, e.g. 'Rehavia Gardens, Apt 12'; for a house the street and city, e.g. 'HaPalmach 8, Jerusalem'"),
  apartmentType: z.enum(["Regular apartment", "Garden apartment", "Penthouse"]).nullish().default(null).describe("Apartments only: דירת גן Garden apartment, פנטהאוז Penthouse, otherwise Regular apartment when the listing describes a normal unit; null when unclear"),
  projectName: z.string().nullish().default(null),
  developerName: z.string().nullish().default(null),
  street: z.string().nullish().default(null).describe("Building address, street and number"),
  city: z.string().nullish().default(null),
  neighborhood: z.string().nullish().default(null),
  rooms: z.number().nullish().default(null),
  completionDate: z.string().nullish().default(null).describe("Year built for an existing building, or expected delivery as MM/YYYY for a new build"),
  floor: z.number().nullish().default(null),
  buildingStories: z.number().nullish().default(null),
  buildingUnits: z.number().nullish().default(null),
  internalSqm: z.number().nullish().default(null).describe("Internal square metres, excluding the mirpeset"),
  mirpesetSqm: z.number().nullish().default(null).describe("Total mirpeset m²; with several mirpasot, the sum"),
  sukka: z.enum(["Yes", "Partial", "No"]).nullish().default(null).describe("Whether a sukka can be built on the mirpeset (מרפסת סוכה): Yes, Partial or No; null when not stated"),
  sukkaSqm: z.number().nullish().default(null).describe("The area the sukka can take, m², when stated"),
  pool: z.enum(["Yes", "No"]).nullish().default(null).describe("A private pool (בריכה) on the mirpeset, garden or roof: Yes or No; null when not stated"),
  poolSqm: z.number().nullish().default(null).describe("Pool size in m², when stated"),
  mirpasot: z.array(z.object({ sqm: z.number().nullish().default(null), direction: z.array(Direction).default([]), sukka: z.enum(["Yes", "Partial", "No"]).nullish().default(null), sukkaSqm: z.number().nullish().default(null), pool: z.enum(["Yes", "No"]).nullish().default(null), poolSqm: z.number().nullish().default(null) })).default([]).describe("Each mirpeset separately when the listing describes more than one; empty otherwise"),
  ceilingCm: z.number().nullish().default(null).describe("Ceiling height; for a house or a duplex, the main level"),
  levels: z.number().nullish().default(null).describe("Apartments only: floors inside the apartment, 1, 2 (duplex) or 3 (triplex)"),
  floors: z.number().nullish().default(null).describe("Houses only: how many floors (miflasim)"),
  houseType: z.enum(["Villa", "Semi-attached", "Cottage"]).nullish().default(null).describe("Houses only: וילה Villa, דו משפחתי Semi-attached, קוטג' Cottage; null when not stated"),
  ceilingCms: z.array(z.number()).default([]).describe("One ceiling height per floor or level, ground first, when the listing gives them; empty otherwise"),
  migrashSqm: z.number().nullish().default(null).describe("Houses only: the plot (migrash) in m²; a dunam is 1,000 m²"),
  machsanSqm: z.number().nullish().default(null),
  machsanLocation: z.enum(["Attached to apartment", "In basement"]).nullish().default(null),
  parkingSpots: z.enum(["None", "1", "2 - back to back", "2 side by side", "3"]).nullish().default(null),
  direction: z.array(Direction).default([]),
  mirpesetDirection: z.array(Direction).default([]),
  mamad: z.boolean().nullish().default(null),
  priceNis: z.number().nullish().default(null).describe("Asking price in shekels. Convert only if the document states a currency and an amount; never guess."),
  sellerType: z.enum(["Yad Rishona (developer)", "Second hand, never occupied", "Second hand, occupied"]).nullish().default(null).describe("Yad rishona means bought from the developer; second hand is a resale, occupied or never lived in"),
  renovationYear: z.number().nullish().default(null).describe("Year of the last renovation, second hand only"),
  description: z.string().nullish().default(null).describe("Two to four plain English sentences about the apartment from the documents. No prices or numbers already captured in fields."),
  extra: z.record(z.string(), z.string().nullable()).nullish().default(null).describe("Answers to the extra questions listed in the message, by their keys; only what the documents state"),
});
const Project = z.object({
  name: z.string().nullish().default(null).describe("The project's name in English"),
  developerName: z.string().nullish().default(null),
  street: z.string().nullish().default(null),
  city: z.string().nullish().default(null),
  neighborhood: z.string().nullish().default(null),
  totalUnits: z.number().nullish().default(null).describe("Units in the whole project"),
  stories: z.number().nullish().default(null),
  parkingSpaces: z.number().nullish().default(null).describe("Parking spaces in the whole project"),
  completionDate: z.string().nullish().default(null).describe("Expected delivery as MM/YYYY, or the year built"),
  pool: z.enum(["Yes", "No"]).nullish().default(null).describe("A shared pool in the project: Yes or No; null when not stated"),
  doorman: z.enum(["Yes", "No"]).nullish().default(null).describe("A doorman or reception (שוער, לובי מאויש) in the building: Yes or No; null when not stated"),
  gym: z.enum(["Yes", "No"]).nullish().default(null).describe("A gym (חדר כושר) for the residents: Yes or No; null when not stated"),
  description: z.string().nullish().default(null).describe("Two to four plain English sentences about the project. No numbers already captured in fields."),
});
const Output = z.object({
  project: Project.nullish().default(null).describe("The whole project (a building or development with several units for sale) when the documents describe one, with or without specific units listed"),
  apartments: z.array(Apartment).default([]),
  agent: z.object({ name: z.string().nullish().default(null), email: z.string().nullish().default(null), phone: z.string().nullish().default(null), company: z.string().nullish().default(null) }).nullish().default(null).describe("The agent or seller who sent the listing, if the message says"),
});
type Extracted = z.infer<typeof Output>;
type ExtractedApartment = Extracted["apartments"][number];

const SYSTEM = `You read messages and documents about apartments for sale in Israel and fill in apartment tickets for RJL Israel.
Rules: one entry per distinct apartment or house, with kind set (a private house on its own plot is a house; anything inside a building is an apartment). A building with several units for sale is several apartments; a whole project description with no specific unit is one apartment named after the project with the unit fields blank). Only record what the documents state; leave a field null when it is not stated. Never use placeholders like TBD. Square metres: internal excludes the mirpeset (balcony); if only a total is given, put it in internalSqm and say so in the description. Prices in shekels; if a price is in dollars, convert only if the document gives the rate, else leave priceNis null and mention the dollar price in the description. Parking must be one of the allowed values. Direction is the apartment's air directions. Mamad is the safe room. The subject line is often stale; trust the body, the attachments and the photos. No dashes as punctuation in text you write.
Hebrew: most of what arrives is in Hebrew. Read it natively. Write every field value in English: cities and neighborhoods in their usual English spelling (ירושלים Jerusalem, תל אביב Tel Aviv, רעננה Ra'anana, הרצליה Herzliya, רחביה Rehavia, קטמון Katamon, בקעה Baka, ארנונה Arnona, טלביה Talbiya), streets and project names transliterated with the Hebrew in parentheses the first time. Vocabulary: חדרים rooms (3.5 חדרים is 3.5 rooms), מ"ר or מטר square metres, מרפסת mirpeset (balcony), מרפסת שמש sun balcony, מרפסת סוכה a mirpeset that takes a sukka (sukka Yes), דירת גן garden apartment (its outdoor space is the garden, read it as the mirpeset fields), פנטהאוז penthouse, בריכה pool, גינה garden, ממ"ד mamad, מחסן machsan (storage), חניה parking (חניה כפולה two spots, בטור back to back, מקבילה side by side), קומה floor, קומת קרקע ground floor, מעלית elevator, קבלן or יזם developer, פרויקט project, יד ראשונה מקבלן yad rishona from the developer, יד שנייה second hand, לא גרו never occupied, משופצת renovated, שנת בניה year built, טופס 4 or מסירה delivery, כיווני אוויר air directions (צפון north, דרום south, מזרח east, מערב west), גובה תקרה ceiling height, מחיר or מבוקש asking price, ש"ח or ₪ shekels, מיליון million (4.2 מיליון is 4,200,000). Text pulled out of Hebrew PDFs sometimes arrives with the letters or words of a line in reverse order; read it in whichever direction makes sense. Photos of listings (Yad2, Madlan, agency flyers) carry the same fields: read the numbers off the image.`;

/** One file that came with the message: text if we could read it, the bytes when it is an image or a candidate floorplan. */
export type IntakeFile = { name: string; type: string | null; size: number; text?: string | null; bytes?: Uint8Array | null };
export type IntakeInput = {
  channel: "EMAIL" | "WHATSAPP";
  key: string; // idempotency key: Message-ID or WhatsApp message id
  subject: string | null;
  body: string;
  files: IntakeFile[];
  sender: { name?: string | null; email?: string | null; phone?: string | null } | null;
  sourceLabel: string; // "Email from Yael Tzur" / "WhatsApp from +972 52 300 1122"
  mailbox: string; // where it arrived (address or WhatsApp number)
};
export type IntakeRow = { id: string; kind: "apartments" | "houses" | "projects"; name: string; line: string; price: string; missing: string[] };
type Kind = "projects" | "apartments" | "houses";
const kindWord = (k: Kind) => (k === "houses" ? "House" : k === "projects" ? "Project" : "Apartment");

/**
 * Instructions from the team above a forwarded email: "project and apartments", "make a house list". Only the
 * forwarder's own words count (the quoted email below the marker is the agent's). Empty when there is none; the
 * documents then decide on their own.
 */
function wantedKinds(body: string): Set<Kind> {
  const own = body.split(/\n\s*(?:From:|-----Original Message-----|On .{5,80} wrote:|מאת:)/i)[0].slice(0, 1500);
  const out = new Set<Kind>();
  if (/\bprojects?\b|פרויקט/i.test(own)) out.add("projects");
  if (/\bapartments?\b|\bapts?\b|\bunits?\b|דיר(ה|ות)/i.test(own)) out.add("apartments");
  if (/\bhouses?\b|\bvillas?\b|\bcottages?\b|בית פרטי|וילה|קוטג/i.test(own)) out.add("houses");
  return out;
}
export type IntakeResult = { rows: IntakeRow[]; note: string | null } | { skipped: string };

async function readAttachments(messageId: string): Promise<IntakeFile[]> {
  const r = await graph<{ value: Att[] }>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
  const out: IntakeFile[] = [];
  for (const a of r.value) {
    if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    if (a.size > 25 * 1024 * 1024) {
      out.push({ name: a.name, type: a.contentType, size: a.size });
      continue;
    }
    const bytes = new Uint8Array(await graph<ArrayBuffer>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}/attachments/${q(a.id)}/$value`, { raw: true }));
    out.push(await describeFile(a.name, a.contentType, bytes));
  }
  return out;
}

/** Text for documents, bytes kept for images (they go to Claude as pictures) and for anything that could be a floorplan. */
export async function describeFile(name: string, type: string | null, bytes: Uint8Array): Promise<IntakeFile> {
  const isImage = (type ?? "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);
  const text = isImage ? null : await attachmentToText(name, type, bytes).catch(() => null);
  return { name, type, size: bytes.byteLength, text, bytes };
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
async function extract(subject: string | null, body: string, files: IntakeFile[]): Promise<Extracted> {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];
  const parts = [`Subject: ${subject ?? ""}`, `Message:\n${body.slice(0, 40_000)}`, ...files.filter((f) => f.text).map((f) => `Attachment ${f.name}:\n${(f.text ?? "").slice(0, 40_000)}`)];
  content.push({ type: "text", text: parts.join("\n\n") });
  // photos of listings and flyers: up to six, under 5 MB each
  for (const f of files.filter((f) => f.bytes && ((f.type && IMAGE_TYPES.has(f.type)) || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) && f.bytes.byteLength < 5 * 1024 * 1024).slice(0, 6)) {
    const media = (f.type && IMAGE_TYPES.has(f.type) ? f.type : /\.png$/i.test(f.name) ? "image/png" : /\.webp$/i.test(f.name) ? "image/webp" : /\.gif$/i.test(f.name) ? "image/gif" : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    content.push({ type: "text", text: `Photo ${f.name}:` });
    content.push({ type: "image", source: { type: "base64", media_type: media, data: Buffer.from(f.bytes!).toString("base64") } });
  }
  // The ticket has more optional fields than the API's structured-output mode allows, so the schema goes in the
  // prompt and the answer is validated here. A field the model leaves out reads as unknown.
  const customQs = [...IL_REQUIRED.apartments.map((i) => ({ ...i, on: "apartments" })), ...IL_REQUIRED.houses.map((i) => ({ ...i, on: "houses" }))].filter((i) => isCustomKey(i.key));
  if (customQs.length) content.push({ type: "text", text: `Extra questions RJL Israel asks on every ticket. Answer each under "extra" by its key when the documents state it, null otherwise: ${customQs.map((i) => `${i.key} (${i.on}): ${i.question || i.label}`).join("; ")}` });
  content.push({ type: "text", text: `Answer with one JSON object only, no prose and no code fence, matching this JSON schema exactly (use null for anything the documents do not state):\n${JSON.stringify(z.toJSONSchema(Output))}` });
  const res = await client.messages.create({ model: "claude-opus-5", max_tokens: 12_000, system: SYSTEM, messages: [{ role: "user", content }] });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const raw = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = Output.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.error("israel intake: answer did not match the schema", parsed.error.issues.slice(0, 5));
  } catch (e) {
    console.error("israel intake: answer was not JSON", String(e).slice(0, 200));
  }
  return { project: null, apartments: [], agent: null };
}

/** Asked only when they apply: the project on a yad rishona apartment, the renovation year on a second-hand unit, a ceiling per level on a duplex. */
function conditionalMissing(a: ExtractedApartment): string[] {
  const out: string[] = [];
  if (a.sellerType?.startsWith("Yad Rishona") && !a.projectName) out.push("Project name");
  if (a.sellerType?.startsWith("Second hand") && a.renovationYear == null) out.push("Year of renovation (or never renovated)");
  if (a.levels && a.levels > 1 && a.ceilingCms.length < a.levels) out.push(`Ceiling height for each of the ${a.levels} levels`);
  if (a.mirpasot.length > 1 && a.mirpasot.some((m) => !m.sukka)) out.push("Sukka (yes, partial or no) for each mirpeset");
  const sukkaYes = (a.sukka && a.sukka !== "No") || a.mirpasot.some((m) => m.sukka && m.sukka !== "No");
  if (sukkaYes && a.sukkaSqm == null && !a.mirpasot.some((m) => m.sukkaSqm != null)) out.push("Sukka area (m²)");
  const poolYes = a.pool === "Yes" || a.mirpasot.some((m) => m.pool === "Yes");
  if (poolYes && a.poolSqm == null && !a.mirpasot.some((m) => m.poolSqm != null)) out.push("Pool size (m²)");
  return out;
}
/** A garden apartment's outdoor space is its garden: the questions say so. */
const gardenWords = (a: ExtractedApartment, labels: string[]) => (a.apartmentType === "Garden apartment" ? labels.map((l) => l.replace(/Mirpeset size (m²), each mirpeset separately if there is more than one/, "Garden size (m²), each garden separately if there is more than one").replace(/Mirpeset direction/, "Garden direction").replace(/Sukka on the mirpeset/, "Sukka in the garden").replace(/for each mirpeset/, "for each garden")) : labels);
/** The extracted field that answers a list key when the ticket column is named differently. */
const EXTRACT_KEY: Record<string, keyof ExtractedApartment> = { totalFloors: "buildingStories" };
/** Whether a Required Items List entry is still blank on what was extracted. */
function blankExtracted(a: ExtractedApartment, key: string, hasDeveloper: boolean, hasPlan = false): boolean {
  if (isCustomKey(key)) return !(a.extra?.[key] ?? "").trim();
  if (key === "floorplanName") return !hasPlan;
  if (key === "developerId") return !hasDeveloper;
  if (key === "brochureName") return false;
  if (key === "ceilingCms") return a.ceilingCms.length === 0 || (a.floors != null && a.ceilingCms.length < a.floors);
  if (key === "sukka") return !a.sukka && !(a.mirpasot.length > 1 && a.mirpasot.every((m) => m.sukka));
  if (key === "pool") return !a.pool && !(a.mirpasot.length > 0 && a.mirpasot.every((m) => m.pool));
  if (key === "mirpesetDirection") return a.mirpesetDirection.length === 0 && !(a.mirpasot.length > 1 && a.mirpasot.every((m) => m.direction.length));
  const k = (EXTRACT_KEY[key] ?? key) as keyof ExtractedApartment;
  if (!(k in a)) return false;
  const v = a[k];
  return v == null || (Array.isArray(v) && v.length === 0);
}
function missingForHouse(a: ExtractedApartment, hasDeveloper: boolean, hasPlan = false): string[] {
  const base = IL_REQUIRED.houses.filter(({ key }) => blankExtracted(a, key, hasDeveloper, hasPlan)).map((r) => r.label);
  const extra = conditionalMissing(a).filter((x) => x !== "Project name");
  if (a.sellerType?.startsWith("Yad Rishona") && !hasDeveloper && !IL_REQUIRED.houses.some((i) => i.key === "developerId")) extra.unshift("Developer");
  return [...base, ...extra];
}
function missingFor(a: ExtractedApartment, hasDeveloper: boolean, hasPlan = false): string[] {
  const base = IL_REQUIRED.apartments.filter(({ key }) => blankExtracted(a, key, hasDeveloper, hasPlan)).map((r) => r.label);
  return gardenWords(a, [...base, ...conditionalMissing(a)]);
}
/** The extra answers as stored on a ticket: JSON, or null when there are none; a later email's answers merge in. */
const extraJson = (e: unknown) => {
  const o = parseExtra(e);
  return Object.keys(o).length ? JSON.stringify(o) : null;
};
const mergedExtra = (old: unknown, add: unknown) => {
  const o = { ...parseExtra(old), ...parseExtra(add) };
  return Object.keys(o).length ? { extra: JSON.stringify(o) } : {};
};

async function findOrCreateCompany(name: string | null, role: string) {
  const n = name?.trim();
  if (!n) return null;
  return (await prisma.ilCompany.findFirst({ where: { name: { equals: n, mode: "insensitive" } } })) ?? prisma.ilCompany.create({ data: { name: n, roles: JSON.stringify([role]) } });
}

async function findOrCreateAgent(agent: Extracted["agent"], sender: IntakeInput["sender"], companyId: string | null) {
  const email = (agent?.email ?? sender?.email ?? "").toLowerCase() || null;
  if (email && INTERNAL.test(email)) return null;
  const phone = agent?.phone ?? sender?.phone ?? null;
  const fullName = (agent?.name ?? sender?.name ?? "").trim();
  if (!email && !phone && !fullName) return null;
  const existing = (email ? await prisma.ilContact.findFirst({ where: { email } }) : null) ?? (phone ? await prisma.ilContact.findFirst({ where: { phone: { contains: phone.replace(/\D/g, "").slice(-9) } } }) : null);
  if (existing) return existing;
  const [firstName, ...rest] = fullName.split(/\s+/);
  return prisma.ilContact.create({ data: { firstName: firstName || null, lastName: rest.join(" ") || null, email, phone, roles: '["Broker"]', companyId } });
}

/** The floorplan among the files: a plan by name, else the biggest photo when there is more than one. */
async function attachFloorplan(files: IntakeFile[], unitId: string, kind: "apartments" | "houses" = "apartments") {
  const withBytes = files.filter((f) => f.bytes && f.size < 20 * 1024 * 1024);
  const isImg = (f: IntakeFile) => (f.type ?? "").startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name);
  const plan = withBytes.find((f) => /plan|tochnit|תכנית|תוכנית/i.test(f.name) && (isImg(f) || f.type === "application/pdf")) ?? withBytes.filter(isImg).sort((a, b) => b.size - a.size)[0];
  if (!plan?.bytes) return;
  const data = { floorplan: Buffer.from(plan.bytes), floorplanType: plan.type ?? "application/octet-stream", floorplanName: plan.name };
  if (kind === "houses") await prisma.ilHouse.update({ where: { id: unitId }, data });
  else await prisma.ilApartment.update({ where: { id: unitId }, data });
}

/**
 * The project a name refers to, if the CRM already has it. Exact name first, then the same street and city, then
 * the name boiled down: parentheticals and Hebrew dropped, the city and filler words removed, so "Laguna Netanya",
 * "Laguna (לגונה)" and "the Laguna project" are one project (Sep 16: Laguna was created twice).
 */
const projectKey = (name: string, city?: string | null) => {
  let s = name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9\s]/g, " ");
  if (city) s = s.replace(new RegExp("\\b" + city.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim() + "\\b", "g"), " ");
  return s.replace(/\b(the|project|projects|tower|towers|park|residence|residences|complex|phase)\b/g, " ").replace(/\s+/g, " ").trim();
};
async function findProject(name: string, city?: string | null, street?: string | null): Promise<{ id: string; name: string; brochureType: string | null } | null> {
  const sel = { id: true, name: true, brochureType: true } as const;
  const clean = name.trim();
  const exact = await prisma.ilProject.findFirst({ where: { name: { equals: clean, mode: "insensitive" } }, select: sel });
  if (exact) return exact;
  if (street && city) {
    const byAddress = await prisma.ilProject.findFirst({ where: { street: { equals: street, mode: "insensitive" }, city: { equals: city, mode: "insensitive" } }, select: sel });
    if (byAddress) return byAddress;
  }
  const key = projectKey(clean, city);
  if (key.length < 4) return null;
  const all = await prisma.ilProject.findMany({ select: { ...sel, city: true } });
  return all.find((p) => { const k = projectKey(p.name, p.city ?? city); return k.length >= 4 && (k === key || k.startsWith(key + " ") || key.startsWith(k + " ")) && (!city || !p.city || p.city.toLowerCase() === city.toLowerCase()); }) ?? null;
}

/** The largest PDF that came with the message becomes the project's brochure. */
async function attachBrochure(files: IntakeFile[], projectId: string) {
  const pdf = files.filter((f) => f.bytes && f.size < 20 * 1024 * 1024 && (f.type === "application/pdf" || /\.pdf$/i.test(f.name))).sort((a, b) => b.size - a.size)[0];
  if (!pdf?.bytes) return;
  await prisma.ilProject.update({ where: { id: projectId }, data: { brochure: Buffer.from(pdf.bytes), brochureType: pdf.type ?? "application/pdf", brochureName: pdf.name } });
}

/**
 * One property, one ticket. A second email about the same apartment or house (the agent answering our questions,
 * a brochure following the teaser) updates the ticket we have: every value the new email states overwrites the
 * old one, blanks stay as they were, the floorplan lands if there was none, and the reply lists what is still
 * missing on the merged ticket. Same unit = same city (or unknown) and names sharing most of their words, unless
 * the names carry different unit numbers ("Apt 12" vs "Apt 15" in one project are two apartments).
 */
const unitWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\u0590-\u05FF ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|apt|apartment|unit|by|of|in|st|street|rd|road|house|villa|cottage)$/.test(w)));
const unitNumbers = (t: string) => new Set((t.match(/\d+[a-z]?/gi) ?? []).map((x) => x.toLowerCase()));
export function sameUnit(a: { name: string; street?: string | null; city?: string | null }, b: { name: string; street?: string | null; city?: string | null }): boolean {
  if (a.city && b.city && a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  const na = unitNumbers(a.name), nb = unitNumbers(b.name);
  if (na.size && nb.size && ![...na].some((n) => nb.has(n))) return false; // different unit numbers
  if (a.street && b.street && a.street.trim().toLowerCase() === b.street.trim().toLowerCase()) return true;
  const A = unitWords(`${a.name} ${a.street ?? ""}`), B = unitWords(`${b.name} ${b.street ?? ""}`);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit > 0 && hit >= Math.min(A.size, B.size) * 0.5;
}
/** New values win; blanks and empty lists never erase what the ticket already has. */
function fillFrom<T extends Record<string, unknown>>(data: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(data) as [keyof T, unknown][]) {
    if (v == null) continue;
    if (typeof v === "string" && (v.trim() === "" || v === "[]")) continue;
    if (k === "name" || k === "source" || k === "sourceMessageId" || k === "pendingApproval") continue;
    out[k] = v as T[keyof T];
  }
  return out;
}

/** The shared core: read, extract, create tickets, link people. Returns the rows for whichever reply the channel writes. */
export async function intakeApartments(input: IntakeInput): Promise<IntakeResult> {
  if (await prisma.ilInbound.findUnique({ where: { messageId: input.key } })) return { skipped: "already processed" };
  const mark = (result: string) => prisma.ilInbound.create({ data: { messageId: input.key, mailbox: input.mailbox, subject: input.subject, fromEmail: input.sender?.email ?? input.sender?.phone ?? null, result } }).catch(() => null);
  await loadIlRequired(); // the Required Items Lists as Jonathan last edited them
  const extracted = await extract(input.subject, input.body, input.files);
  const senderIsInternal = input.sender?.email ? INTERNAL.test(input.sender.email) : false;
  // the team's instructions above a forwarded email decide what lists come back; one kind named for the units forces it
  const wants = senderIsInternal ? wantedKinds(input.body) : new Set<Kind>();
  if (wants.size && !wants.has("projects") && (wants.has("apartments") !== wants.has("houses"))) for (const a of extracted.apartments) a.kind = wants.has("houses") ? "house" : "apartment";
  if (wants.size === 2 && wants.has("projects") && (wants.has("apartments") !== wants.has("houses"))) for (const a of extracted.apartments) a.kind = wants.has("houses") ? "house" : "apartment";
  const first = extracted.apartments[0];
  const proj = extracted.project?.name
    ? extracted.project
    : wants.has("projects")
      ? { name: first?.projectName ?? (input.subject ?? "Project").replace(/^\s*(fwd?|re|fw)\s*:\s*/i, ""), developerName: first?.developerName ?? null, street: first?.street ?? null, city: first?.city ?? null, neighborhood: first?.neighborhood ?? null, totalUnits: first?.buildingUnits ?? null, stories: first?.buildingStories ?? null, parkingSpaces: null, completionDate: first?.completionDate ?? null, pool: null, doorman: null, gym: null, description: null }
      : null;
  if (!extracted.apartments.length && !proj) {
    await mark("skipped: no apartment or house found");
    return { skipped: "no apartments" };
  }
  const agentCompany = await findOrCreateCompany(extracted.agent?.company ?? null, "Broker");
  const agent = await findOrCreateAgent(extracted.agent, senderIsInternal ? null : input.sender, agentCompany?.id ?? null);
  const rows: IntakeRow[] = [];
  const fileNames = input.files.map((f) => f.name);
  const origin = `Created from ${input.channel === "WHATSAPP" ? "a WhatsApp message" : `an email to ${input.mailbox}`}${input.subject ? `: "${input.subject}"` : ""}${fileNames.length ? ` with ${fileNames.join(", ")}` : ""}`;
  // a floorplan among the files satisfies the Floorplan line when there is one unit to give it to
  const planFile = extracted.apartments.length === 1 && input.files.some((f) => (f.type ?? "").startsWith("image/") || f.type === "application/pdf" || /\.(png|jpe?g|webp|pdf)$/i.test(f.name));
  // the project ticket: the whole building or development, when the documents describe one or the team asked for it
  let projectRow: { id: string; name: string } | null = null;
  if (proj?.name) {
    const pname = stripDashes(proj.name).trim();
    const existing = await findProject(pname, proj.city, proj.street);
    const dev = await findOrCreateCompany(proj.developerName ?? null, "Sponsor (Yazam)");
    const pdata = { name: pname, developerId: dev?.id ?? null, street: proj.street ?? null, city: proj.city ?? null, neighborhood: proj.neighborhood ?? null, totalUnits: proj.totalUnits ?? null, stories: proj.stories ?? null, parkingSpaces: proj.parkingSpaces ?? null, completionDate: proj.completionDate ?? null, pool: proj.pool ?? null, doorman: proj.doorman ?? null, gym: proj.gym ?? null, agentContactId: agent?.id ?? null, description: proj.description ? stripDashes(proj.description) : null };
    projectRow = existing ? await prisma.ilProject.update({ where: { id: existing.id }, data: fillFrom(pdata) }) : await prisma.ilProject.create({ data: pdata });
    await prisma.ilNote.create({ data: { projectId: projectRow.id, body: existing ? origin.replace(/^Created from/, "Updated from") : origin } });
    if (!existing?.brochureType) await attachBrochure(input.files, projectRow.id).catch(() => null);
    const fresh = await prisma.ilProject.findUnique({ where: { id: projectRow.id }, omit: { brochure: true } });
    const { projectMissing } = await import("@/lib/israel");
    rows.push({ id: projectRow.id, kind: "projects", name: projectRow.name, line: [proj.totalUnits ? `${proj.totalUnits} units` : null, proj.stories ? `${proj.stories} stories` : null, [proj.neighborhood, proj.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: "", missing: fresh ? projectMissing(fresh as unknown as Record<string, unknown>) : [] });
  }
  const mirpasot = (a: ExtractedApartment) => {
    const list = a.mirpasot.filter((m) => m.sqm != null || m.direction.length || m.sukka).slice(0, 3);
    const total = list.length > 1 ? list.reduce((t, m) => t + (m.sqm ?? 0), 0) : null;
    const single = { sqm: a.mirpesetSqm ?? null, direction: a.mirpesetDirection, sukka: a.sukka ?? null, sukkaSqm: a.sukkaSqm ?? null, pool: null, poolSqm: null };
    return { mirpesetCount: list.length > 1 ? list.length : a.mirpesetSqm != null ? 1 : null, mirpesetSqm: a.mirpesetSqm ?? (total || null), mirpesetDirection: JSON.stringify(list.length > 1 ? [...new Set(list.flatMap((m) => m.direction))] : a.mirpesetDirection), mirpasot: JSON.stringify(list.length > 1 ? list : single.sqm != null || single.direction.length || single.sukka || single.pool ? [single] : []) };
  };
  for (const a of extracted.apartments) {
    const developer = await findOrCreateCompany(a.developerName, "Sponsor (Yazam)");
    if (a.kind === "house") {
      let houseProject = null as { id: string } | null;
      if (a.projectName?.trim()) {
        houseProject = (await findProject(a.projectName.trim(), a.city)) ?? (await prisma.ilProject.create({ data: { name: a.projectName.trim(), developerId: developer?.id ?? null, street: a.street, city: a.city, neighborhood: a.neighborhood, completionDate: a.completionDate } }));
      }
      const houseData = {
          name: stripDashes(a.name) || a.street || "House",
          houseType: a.houseType,
          projectId: houseProject?.id ?? projectRow?.id ?? null,
          street: a.street,
          city: a.city,
          neighborhood: a.neighborhood,
          developerId: developer?.id ?? null,
          agentContactId: agent?.id ?? null,
          rooms: a.rooms,
          floors: a.floors,
          ceilingCms: JSON.stringify(a.ceilingCms.length ? a.ceilingCms : a.ceilingCm != null ? [a.ceilingCm] : []),
          completionDate: a.completionDate,
          internalSqm: a.internalSqm,
          ...mirpasot(a),
          migrashSqm: a.migrashSqm,
          parkingSpots: a.parkingSpots && (IL_PARKING as readonly string[]).includes(a.parkingSpots) ? a.parkingSpots : null,
          sellerType: a.sellerType,
          renovationYear: a.sellerType?.startsWith("Second hand") ? a.renovationYear : null,
          mamad: a.mamad ?? null,
          priceNis: a.priceNis,
          description: a.description ? stripDashes(a.description) : null,
          pool: a.pool ?? (a.mirpasot.some((m) => m.pool === "Yes") ? "Yes" : null),
          poolSqm: a.poolSqm ?? null,
          extra: extraJson(a.extra),
          source: input.sourceLabel,
          sourceMessageId: input.key,
          pendingApproval: true,
      };
      const candidates = await prisma.ilHouse.findMany({ select: { id: true, name: true, street: true, city: true, floorplanType: true, extra: true } });
      const found = candidates.find((h) => sameUnit({ name: houseData.name, street: a.street, city: a.city }, h));
      const house = found
        ? await prisma.ilHouse.update({ where: { id: found.id }, data: { ...fillFrom(houseData), ...mergedExtra(found.extra, a.extra) } })
        : await prisma.ilHouse.create({ data: houseData });
      await prisma.ilNote.create({ data: { houseId: house.id, body: found ? origin.replace(/^Created from/, "Updated from") : origin } });
      if (extracted.apartments.length === 1 && !(found?.floorplanType)) await attachFloorplan(input.files, house.id, "houses").catch(() => null);
      const { houseMissing } = await import("@/lib/israel");
      rows.push({ id: house.id, kind: "houses", name: house.name, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, a.migrashSqm ? `${sqm(a.migrashSqm)} migrash` : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: found ? houseMissing((await prisma.ilHouse.findUnique({ where: { id: house.id } })) as unknown as Record<string, unknown>) : missingForHouse(a, Boolean(developer), planFile) });
      continue;
    }
    let project = null as { id: string } | null;
    if (a.projectName?.trim()) {
      project = (await findProject(a.projectName.trim(), a.city)) ?? (await prisma.ilProject.create({ data: { name: a.projectName.trim(), developerId: developer?.id ?? null, street: a.street, city: a.city, neighborhood: a.neighborhood, stories: a.buildingStories, totalUnits: a.buildingUnits, completionDate: a.completionDate } }));
    }
    const aptData = {
        name: stripDashes(a.name) || a.street || "Apartment",
        apartmentType: a.apartmentType,
        street: a.street,
        city: a.city,
        neighborhood: a.neighborhood,
        projectId: project?.id ?? projectRow?.id ?? null,
        projectName: a.projectName,
        developerId: developer?.id ?? null,
        agentContactId: agent?.id ?? null,
        rooms: a.rooms,
        completionDate: a.completionDate,
        floor: a.floor,
        totalFloors: a.buildingStories,
        buildingUnits: a.buildingUnits,
        internalSqm: a.internalSqm,
        ...mirpasot(a),
        levels: a.levels && a.levels > 1 ? Math.min(a.levels, 3) : null,
        ceilingCms: JSON.stringify(a.levels && a.levels > 1 ? a.ceilingCms : []),
        ceilingCm: a.ceilingCm ?? a.ceilingCms[0] ?? null,
        machsanSqm: a.machsanSqm,
        machsanLocation: a.machsanLocation && (IL_MACHSAN_LOCATIONS as readonly string[]).includes(a.machsanLocation) ? a.machsanLocation : null,
        parkingSpots: a.parkingSpots && (IL_PARKING as readonly string[]).includes(a.parkingSpots) ? a.parkingSpots : null,
        direction: JSON.stringify(a.direction),
        mamad: a.mamad ?? null,
        priceNis: a.priceNis,
        sellerType: a.sellerType,
        renovationYear: a.sellerType?.startsWith("Second hand") ? a.renovationYear : null,
        description: a.description ? stripDashes(a.description) : null,
        pool: a.pool ?? (a.mirpasot.some((m) => m.pool === "Yes") ? "Yes" : null),
        poolSqm: a.poolSqm ?? a.mirpasot.find((m) => m.poolSqm != null)?.poolSqm ?? null,
        extra: extraJson(a.extra),
        source: input.sourceLabel,
        sourceMessageId: input.key,
        pendingApproval: true,
    };
    const aptCandidates = await prisma.ilApartment.findMany({ select: { id: true, name: true, street: true, city: true, floorplanType: true, extra: true } });
    const foundApt = aptCandidates.find((x) => sameUnit({ name: aptData.name, street: a.street, city: a.city }, x));
    const created = foundApt
      ? await prisma.ilApartment.update({ where: { id: foundApt.id }, data: { ...fillFrom(aptData), ...mergedExtra(foundApt.extra, a.extra) } })
      : await prisma.ilApartment.create({ data: aptData });
    await prisma.ilNote.create({ data: { apartmentId: created.id, body: foundApt ? origin.replace(/^Created from/, "Updated from") : origin } });
    if (extracted.apartments.length === 1 && !(foundApt?.floorplanType)) await attachFloorplan(input.files, created.id).catch(() => null);
    rows.push({ id: created.id, kind: "apartments", name: created.name, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: foundApt ? (await import("@/lib/israel")).apartmentMissing((await prisma.ilApartment.findUnique({ where: { id: created.id } })) as unknown as Record<string, unknown>) : missingFor(a, Boolean(developer), planFile) });
  }
  await mark(`created ${rows.length}`);
  const note = agent ? `Agent on file: ${[agent.firstName, agent.lastName].filter(Boolean).join(" ") || agent.email || agent.phone}.` : null;
  // whatever the project knows (units, stories, delivery) fills blanks on the units filed under it
  if (projectRow) await (await import("@/app/israel/actions")).syncProjectToUnits(projectRow.id).catch(() => null);
  const asked = [...wants].filter((k) => !rows.some((r) => r.kind === k));
  const askedNote = asked.length ? `You asked for ${asked.map((k) => (k === "projects" ? "a project" : k === "houses" ? "a house" : "an apartment")).join(" and ")} list too, but the documents describe none; send the material or add it by hand.` : null;
  return { rows, note: [note, askedNote].filter(Boolean).join(" ") || null };
}

export const appBase = () => (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");

function replyHtml(rows: IntakeRow[], base: string, note: string | null): string {
  const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const blocks = rows
    .map(
      (r) => `<p style="margin:10pt 0 4pt 0;"><b><a href="${base}/israel/${r.kind}/${r.id}">${r.name}</a></b>${r.kind !== "apartments" ? ` <span style="color:#6b716e;">(${r.kind === "houses" ? "house" : "project"})</span>` : ""}${r.line ? ` <span style="color:#6b716e;">${r.line}</span>` : ""}${r.price ? ` <span style="color:#6b716e;">${r.price}</span>` : ""}</p>
${r.missing.length ? `<div style="margin:0 0 4pt 0;">Still needed to complete the ticket (${r.missing.length}):</div><ol style="margin:0 0 6pt 18pt;">${r.missing.map((m) => `<li>${m}</li>`).join("")}</ol>` : `<div style="margin:0 0 6pt 0;">Nothing missing. The ticket is complete.</div>`}`,
    )
    .join("");
  return `<div style="${font}">
<p>${rows.length === 1 ? `${kindWord(rows[0].kind)} ticket updated in` : `${rows.length} tickets updated in`} RJL Israel (a new listing gets a new ticket; a second email about the same unit updates the one we have). ${rows.some((r) => r.missing.length) ? "Tickets with data missing wait under Deals to be approved on the dashboard until the data is in and Jonathan approves them." : ""}</p>
${blocks}
${note ? `<p style="color:#6b716e;">${note}</p>` : ""}
<p style="color:#6b716e;font-size:9pt;">Reply to the agent for the missing items and forward their answer here; edit anything on the ticket in the CRM. A floorplan attached to the email is saved on the ticket.</p>
</div>`;
}

/** The same reply as plain text, for WhatsApp. */
export function replyText(rows: IntakeRow[], base: string, note: string | null): string {
  const lines = [rows.length === 1 ? `${kindWord(rows[0].kind)} ticket created in RJL Israel.` : `${rows.length} tickets created in RJL Israel.`];
  for (const r of rows) {
    lines.push("", `*${r.name}*${r.kind !== "apartments" ? ` (${r.kind === "houses" ? "house" : "project"})` : ""}${r.line ? ` · ${r.line}` : ""}${r.price ? ` · ${r.price}` : ""}`, `${base}/israel/${r.kind}/${r.id}`);
    lines.push(r.missing.length ? `Still missing: ${r.missing.join(", ")}` : "Nothing missing, the ticket is complete.");
  }
  if (rows.some((r) => r.missing.length)) lines.push("", "Tickets with data missing wait under Deals to be approved until the data is in.");
  if (note) lines.push(note);
  return lines.join("\n");
}
export const NO_APARTMENT_TEXT = "I could not find an apartment or a house in this message or its files, so no ticket was created. Send the listing with the details (address, size, price) or add it by hand under Apartments or Houses in RJL Israel.";

async function replyOnThread(msg: Msg, html: string) {
  const draft = await graph<{ id: string }>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(msg.id)}/createReply`, { method: "POST", body: JSON.stringify({}) });
  const to = msg.from?.emailAddress.address ? [{ emailAddress: { address: msg.from.emailAddress.address } }] : [];
  await graph(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(draft.id)}`, { method: "PATCH", body: JSON.stringify({ body: { contentType: "html", content: html }, toRecipients: to }) });
  await graph(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(draft.id)}/send`, { method: "POST" });
}

export async function processIsraelMessage(messageId: string): Promise<{ apartments: number } | { skipped: string }> {
  const msg = await graph<Msg>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}?$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,from,body`);
  const key = msg.internetMessageId ?? msg.id;
  if (await prisma.ilInbound.findUnique({ where: { messageId: key } })) return { skipped: "already processed" };
  const from = msg.from?.emailAddress.address?.toLowerCase() ?? "";
  if (from === ISRAEL_MAILBOX().toLowerCase()) return { skipped: "own reply" };
  if (/^(automatic reply|out of office|undeliverable)/i.test(msg.subject ?? "")) {
    await prisma.ilInbound.create({ data: { messageId: key, mailbox: ISRAEL_MAILBOX(), subject: msg.subject, fromEmail: from || null, result: "skipped: auto-reply" } }).catch(() => null);
    return { skipped: "auto-reply" };
  }
  const bodyText = msg.body?.contentType?.toLowerCase() === "html" ? emailHtmlToText(msg.body.content) : (msg.body?.content ?? "");
  const files = msg.hasAttachments ? await readAttachments(msg.id) : [];
  const r = await intakeApartments({ channel: "EMAIL", key, subject: msg.subject, body: bodyText, files, sender: { name: msg.from?.emailAddress.name, email: from || null }, sourceLabel: `Email from ${msg.from?.emailAddress.name ?? from}`, mailbox: ISRAEL_MAILBOX() });
  if ("skipped" in r) {
    if (r.skipped === "no apartments") await replyOnThread(msg, `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;"><p>${NO_APARTMENT_TEXT}</p></div>`).catch(() => null);
    return r;
  }
  await replyOnThread(msg, replyHtml(r.rows, appBase(), r.note)).catch((e) => console.error("israel intake reply failed", e));
  return { apartments: r.rows.length };
}

export async function processIsraelInbox(): Promise<{ processed: number; skipped: number } | { skipped: string }> {
  if (!graphConfigured()) return { skipped: "Graph not configured" };
  const r = await graph<{ value: Msg[] }>(`/users/${q(ISRAEL_MAILBOX())}/mailFolders/inbox/messages?$top=25&$orderby=receivedDateTime desc&$select=id,internetMessageId,from`).catch((e) => ({ error: String(e) }) as { value?: Msg[]; error?: string });
  if (!("value" in r) || !r.value) return { skipped: `mailbox unreachable: ${(r as { error?: string }).error ?? "unknown"}` };
  let processed = 0, skipped = 0;
  for (const m of r.value) {
    const res = await processIsraelMessage(m.id).catch((e) => ({ skipped: String(e).slice(0, 120) }));
    if ("skipped" in res) skipped++;
    else processed++;
  }
  return { processed, skipped };
}

/** Graph change notification for the Israel mailbox, same endpoint as deals@. */
export async function ensureIsraelSubscription(): Promise<string> {
  if (!graphConfigured() || !process.env.APP_URL || !process.env.CRON_SECRET) return "not configured";
  const resource = `/users/${ISRAEL_MAILBOX()}/mailFolders/inbox/messages`;
  const notificationUrl = `${process.env.APP_URL.replace(/\/$/, "")}/api/graph/notify`;
  if (!notificationUrl.startsWith("https://")) return "skipped: Graph only notifies https URLs";
  const realm = realmFor(`/users/${ISRAEL_MAILBOX()}/`);
  const subs = await graph<{ value: { id: string; resource: string; notificationUrl: string }[] }>("/subscriptions", { realm });
  const mine = subs.value.find((s) => s.resource.toLowerCase() === resource.toLowerCase() && s.notificationUrl === notificationUrl);
  const expiration = new Date(Date.now() + 4000 * 60_000).toISOString();
  if (mine) {
    await graph(`/subscriptions/${mine.id}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime: expiration }), realm });
    return `renewed ${mine.id}`;
  }
  const created = await graph<{ id: string }>("/subscriptions", { method: "POST", body: JSON.stringify({ changeType: "created", notificationUrl, resource, expirationDateTime: expiration, clientState: process.env.CRON_SECRET }), realm });
  return `created ${created.id}`;
}
