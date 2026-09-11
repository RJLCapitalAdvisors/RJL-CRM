import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, graphConfigured, realmFor } from "@/lib/graph";
import { attachmentToText, emailHtmlToText } from "@/lib/attachments";
import { IL_MACHSAN_LOCATIONS, IL_PARKING, nis, pricePerMeter, sqm } from "@/lib/israel";
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
  mirpasot: z.array(z.object({ sqm: z.number().nullish().default(null), direction: z.array(Direction).default([]), sukka: z.enum(["Yes", "Partial", "No"]).nullish().default(null) })).default([]).describe("Each mirpeset separately when the listing describes more than one; empty otherwise"),
  ceilingCm: z.number().nullish().default(null).describe("Ceiling height; for a house or a duplex, the main level"),
  levels: z.number().nullish().default(null).describe("Apartments only: floors inside the apartment, 1, 2 (duplex) or 3 (triplex)"),
  floors: z.number().nullish().default(null).describe("Houses only: how many floors (miflasim)"),
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
});
const Output = z.object({
  apartments: z.array(Apartment).default([]),
  agent: z.object({ name: z.string().nullish().default(null), email: z.string().nullish().default(null), phone: z.string().nullish().default(null), company: z.string().nullish().default(null) }).nullish().default(null).describe("The agent or seller who sent the listing, if the message says"),
});
type Extracted = z.infer<typeof Output>;
type ExtractedApartment = Extracted["apartments"][number];

const SYSTEM = `You read messages and documents about apartments for sale in Israel and fill in apartment tickets for RJL Israel.
Rules: one entry per distinct apartment or house, with kind set (a private house on its own plot is a house; anything inside a building is an apartment). A building with several units for sale is several apartments; a whole project description with no specific unit is one apartment named after the project with the unit fields blank). Only record what the documents state; leave a field null when it is not stated. Never use placeholders like TBD. Square metres: internal excludes the mirpeset (balcony); if only a total is given, put it in internalSqm and say so in the description. Prices in shekels; if a price is in dollars, convert only if the document gives the rate, else leave priceNis null and mention the dollar price in the description. Parking must be one of the allowed values. Direction is the apartment's air directions. Mamad is the safe room. The subject line is often stale; trust the body, the attachments and the photos. No dashes as punctuation in text you write.
Hebrew: most of what arrives is in Hebrew. Read it natively. Write every field value in English: cities and neighborhoods in their usual English spelling (ירושלים Jerusalem, תל אביב Tel Aviv, רעננה Ra'anana, הרצליה Herzliya, רחביה Rehavia, קטמון Katamon, בקעה Baka, ארנונה Arnona, טלביה Talbiya), streets and project names transliterated with the Hebrew in parentheses the first time. Vocabulary: חדרים rooms (3.5 חדרים is 3.5 rooms), מ"ר or מטר square metres, מרפסת mirpeset (balcony), מרפסת שמש sun balcony, מרפסת סוכה a mirpeset that takes a sukka (sukka Yes), גינה garden, ממ"ד mamad, מחסן machsan (storage), חניה parking (חניה כפולה two spots, בטור back to back, מקבילה side by side), קומה floor, קומת קרקע ground floor, מעלית elevator, קבלן or יזם developer, פרויקט project, יד ראשונה מקבלן yad rishona from the developer, יד שנייה second hand, לא גרו never occupied, משופצת renovated, שנת בניה year built, טופס 4 or מסירה delivery, כיווני אוויר air directions (צפון north, דרום south, מזרח east, מערב west), גובה תקרה ceiling height, מחיר or מבוקש asking price, ש"ח or ₪ shekels, מיליון million (4.2 מיליון is 4,200,000). Text pulled out of Hebrew PDFs sometimes arrives with the letters or words of a line in reverse order; read it in whichever direction makes sense. Photos of listings (Yad2, Madlan, agency flyers) carry the same fields: read the numbers off the image.`;

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
export type IntakeRow = { id: string; kind: "apartments" | "houses"; name: string; line: string; price: string; missing: string[] };
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
  return { apartments: [], agent: null };
}

/** What Jonathan wants on every ticket, in his order; the reply lists whichever are still blank. */
const REQUIRED: { key: keyof ExtractedApartment | "developer"; label: string }[] = [
  { key: "developer", label: "Developer" },
  { key: "street", label: "Building address" },
  { key: "city", label: "City" },
  { key: "completionDate", label: "Year of construction or expected date of delivery (month and year)" },
  { key: "internalSqm", label: "Internal m²" },
  { key: "mirpesetSqm", label: "Mirpeset size (m²)" },
  { key: "priceNis", label: "Asking price" },
  { key: "sellerType", label: "Seller type (yad rishona or second hand)" },
  { key: "ceilingCm", label: "Ceiling height (cm)" },
  { key: "parkingSpots", label: "Parking spots" },
  { key: "machsanSqm", label: "Machsan size (m²)" },
  { key: "machsanLocation", label: "Machsan location" },
  { key: "direction", label: "Apartment direction" },
  { key: "mirpesetDirection", label: "Mirpeset direction" },
  { key: "buildingStories", label: "Building stories" },
  { key: "buildingUnits", label: "Total building units" },
  { key: "floor", label: "Apartment floor" },
  { key: "mamad", label: "Mamad (yes or no)" },
];
const REQUIRED_HOUSE: { key: keyof ExtractedApartment; label: string }[] = [
  { key: "street", label: "Address" },
  { key: "city", label: "City" },
  { key: "completionDate", label: "Built or expected delivery" },
  { key: "internalSqm", label: "Internal m²" },
  { key: "mirpesetSqm", label: "Mirpeset size (m²)" },
  { key: "floors", label: "How many floors" },
  { key: "ceilingCms", label: "Ceiling height per floor (cm)" },
  { key: "migrashSqm", label: "Migrash size (m²)" },
  { key: "priceNis", label: "Asking price" },
  { key: "sellerType", label: "Seller type (yad rishona or second hand)" },
  { key: "parkingSpots", label: "Parking" },
  { key: "mamad", label: "Mamad (yes or no)" },
];
function missingForHouse(a: ExtractedApartment): string[] {
  return REQUIRED_HOUSE.filter(({ key }) => {
    const v = a[key];
    return v == null || (Array.isArray(v) && v.length === 0);
  }).map((r) => r.label);
}
function missingFor(a: ExtractedApartment, hasDeveloper: boolean): string[] {
  return REQUIRED.filter(({ key }) => {
    if (key === "developer") return !hasDeveloper;
    const v = a[key];
    return v == null || (Array.isArray(v) && v.length === 0);
  }).map((r) => r.label);
}

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

/** The shared core: read, extract, create tickets, link people. Returns the rows for whichever reply the channel writes. */
export async function intakeApartments(input: IntakeInput): Promise<IntakeResult> {
  if (await prisma.ilInbound.findUnique({ where: { messageId: input.key } })) return { skipped: "already processed" };
  const mark = (result: string) => prisma.ilInbound.create({ data: { messageId: input.key, mailbox: input.mailbox, subject: input.subject, fromEmail: input.sender?.email ?? input.sender?.phone ?? null, result } }).catch(() => null);
  const extracted = await extract(input.subject, input.body, input.files);
  if (!extracted.apartments.length) {
    await mark("skipped: no apartment or house found");
    return { skipped: "no apartments" };
  }
  const senderIsInternal = input.sender?.email ? INTERNAL.test(input.sender.email) : false;
  const agentCompany = await findOrCreateCompany(extracted.agent?.company ?? null, "Broker");
  const agent = await findOrCreateAgent(extracted.agent, senderIsInternal ? null : input.sender, agentCompany?.id ?? null);
  const rows: IntakeRow[] = [];
  const fileNames = input.files.map((f) => f.name);
  const origin = `Created from ${input.channel === "WHATSAPP" ? "a WhatsApp message" : `an email to ${input.mailbox}`}${input.subject ? `: "${input.subject}"` : ""}${fileNames.length ? ` with ${fileNames.join(", ")}` : ""}`;
  const mirpasot = (a: ExtractedApartment) => {
    const list = a.mirpasot.filter((m) => m.sqm != null || m.direction.length || m.sukka).slice(0, 3);
    const total = list.length > 1 ? list.reduce((t, m) => t + (m.sqm ?? 0), 0) : null;
    const single = { sqm: a.mirpesetSqm ?? null, direction: a.mirpesetDirection, sukka: a.sukka ?? null };
    return { mirpesetCount: list.length > 1 ? list.length : a.mirpesetSqm != null ? 1 : null, mirpesetSqm: a.mirpesetSqm ?? (total || null), mirpesetDirection: JSON.stringify(list.length > 1 ? [...new Set(list.flatMap((m) => m.direction))] : a.mirpesetDirection), mirpasot: JSON.stringify(list.length > 1 ? list : single.sqm != null || single.direction.length || single.sukka ? [single] : []) };
  };
  for (const a of extracted.apartments) {
    const developer = await findOrCreateCompany(a.developerName, "Developer (Yazam)");
    if (a.kind === "house") {
      const house = await prisma.ilHouse.create({
        data: {
          name: stripDashes(a.name) || a.street || "House",
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
          mamad: a.mamad ?? false,
          priceNis: a.priceNis,
          description: a.description ? stripDashes(a.description) : null,
          source: input.sourceLabel,
          sourceMessageId: input.key,
          pendingApproval: true,
        },
      });
      await prisma.ilNote.create({ data: { houseId: house.id, body: origin } });
      if (extracted.apartments.length === 1) await attachFloorplan(input.files, house.id, "houses").catch(() => null);
      rows.push({ id: house.id, kind: "houses", name: house.name, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, a.migrashSqm ? `${sqm(a.migrashSqm)} migrash` : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: missingForHouse(a) });
      continue;
    }
    let project = null as { id: string } | null;
    if (a.projectName?.trim()) {
      project = (await prisma.ilProject.findFirst({ where: { name: { equals: a.projectName.trim(), mode: "insensitive" } } })) ?? (await prisma.ilProject.create({ data: { name: a.projectName.trim(), developerId: developer?.id ?? null, street: a.street, city: a.city, neighborhood: a.neighborhood, stories: a.buildingStories, totalUnits: a.buildingUnits, completionDate: a.completionDate } }));
    }
    const created = await prisma.ilApartment.create({
      data: {
        name: stripDashes(a.name) || a.street || "Apartment",
        street: a.street,
        city: a.city,
        neighborhood: a.neighborhood,
        projectId: project?.id ?? null,
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
        mamad: a.mamad ?? false,
        priceNis: a.priceNis,
        sellerType: a.sellerType,
        renovationYear: a.sellerType?.startsWith("Second hand") ? a.renovationYear : null,
        description: a.description ? stripDashes(a.description) : null,
        source: input.sourceLabel,
        sourceMessageId: input.key,
        pendingApproval: true,
      },
    });
    await prisma.ilNote.create({ data: { apartmentId: created.id, body: origin } });
    if (extracted.apartments.length === 1) await attachFloorplan(input.files, created.id).catch(() => null);
    rows.push({ id: created.id, kind: "apartments", name: created.name, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: missingFor(a, Boolean(developer)) });
  }
  await mark(`created ${rows.length}`);
  const note = agent ? `Agent on file: ${[agent.firstName, agent.lastName].filter(Boolean).join(" ") || agent.email || agent.phone}.` : null;
  return { rows, note };
}

export const appBase = () => (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");

function replyHtml(rows: IntakeRow[], base: string, note: string | null): string {
  const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const blocks = rows
    .map(
      (r) => `<p style="margin:10pt 0 4pt 0;"><b><a href="${base}/israel/${r.kind}/${r.id}">${r.name}</a></b>${r.kind === "houses" ? ' <span style="color:#6b716e;">(house)</span>' : ""}${r.line ? ` <span style="color:#6b716e;">${r.line}</span>` : ""}${r.price ? ` <span style="color:#6b716e;">${r.price}</span>` : ""}</p>
${r.missing.length ? `<div style="margin:0 0 4pt 0;">Still missing:</div><ol style="margin:0 0 6pt 18pt;">${r.missing.map((m) => `<li>${m}</li>`).join("")}</ol>` : `<div style="margin:0 0 6pt 0;">Nothing missing. The ticket is complete.</div>`}`,
    )
    .join("");
  return `<div style="${font}">
<p>${rows.length === 1 ? (rows[0].kind === "houses" ? "House ticket created" : "Apartment ticket created") : `${rows.length} tickets created`} in RJL Israel. ${rows.some((r) => r.missing.length) ? "Tickets with data missing wait under Deals to be approved on the dashboard until the data is in and Jonathan approves them." : ""}</p>
${blocks}
${note ? `<p style="color:#6b716e;">${note}</p>` : ""}
<p style="color:#6b716e;font-size:9pt;">Reply to the agent for the missing items and forward their answer here; edit anything on the ticket in the CRM. A floorplan attached to the email is saved on the ticket.</p>
</div>`;
}

/** The same reply as plain text, for WhatsApp. */
export function replyText(rows: IntakeRow[], base: string, note: string | null): string {
  const lines = [rows.length === 1 ? `${rows[0].kind === "houses" ? "House" : "Apartment"} ticket created in RJL Israel.` : `${rows.length} tickets created in RJL Israel.`];
  for (const r of rows) {
    lines.push("", `*${r.name}*${r.kind === "houses" ? " (house)" : ""}${r.line ? ` · ${r.line}` : ""}${r.price ? ` · ${r.price}` : ""}`, `${base}/israel/${r.kind}/${r.id}`);
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
