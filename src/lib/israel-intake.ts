import Anthropic from "@anthropic-ai/sdk";
import { syncProjectToUnits } from "@/lib/israel-sync";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, graphConfigured, realmFor } from "@/lib/graph";
import { attachmentToText, emailHtmlToText } from "@/lib/attachments";
import { IL_MACHSAN_LOCATIONS, IL_PARKING, IL_REQUIRED, isCustomKey, nis, parseExtra, pricePerMeter, sqm, reconcileMirpasot, hasHouseNumber, IL_AMENITIES, cleanNeighborhood } from "@/lib/israel";
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
  degem: z.string().nullish().default(null).describe("The unit type code (degem) on a developer's plans or price list, e.g. UA1, D, PH4; null when there is none"),
  apartmentType: z.enum(["Regular apartment", "Garden apartment", "Penthouse"]).nullish().default(null).describe("Apartments only: דירת גן Garden apartment, פנטהאוז Penthouse, otherwise Regular apartment when the listing describes a normal unit; null when unclear"),
  projectName: z.string().nullish().default(null),
  developerName: z.string().nullish().default(null).describe("The lead developer (יזם) of the project"),
  developerNames: z.array(z.string()).default([]).describe("Every developer of the project when there is more than one (a joint venture, 'Ramot Ba'ir and Adi Capital'), lead first; empty when only developerName applies"),
  planPage: z.number().nullish().default(null).describe("When a floor plan deck is attached as pictures: the page number (as captioned, 1-based) where this unit's floor plan is drawn, so the CRM can cut that page out as the unit's floorplan; null when no page shows it"),
  street: z.string().nullish().default(null).describe("Building address, street and number"),
  city: z.string().nullish().default(null),
  neighborhood: z.string().nullish().default(null),
  rooms: z.number().nullish().default(null),
  bathrooms: z.number().nullish().default(null).describe("Apartments: bathrooms stated or counted on the plan; a toilet with a tub or shower is one, a toilet room alone is 0.5"),
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
  machsan: z.enum(["Yes", "No"]).nullish().default(null).describe("Is there a machsan (storage room): Yes when one is drawn, listed or priced, No when the documents say there is none; null when not stated"),
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
  developerName: z.string().nullish().default(null).describe("The lead developer (יזם)"),
  developerNames: z.array(z.string()).default([]).describe("Every developer when there is more than one (a joint venture), lead first"),
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
  amenities: z.array(z.enum(["Doorman", "Pool", "Gym", "Jacuzzi", "Sauna", "Yoga/Pilates Studio", "Co-working spaces"])).default([]).describe("Everything the project offers its residents that the documents state: Doorman (שוער, לובי), Pool (בריכה), Gym (חדר כושר), Jacuzzi (ג'קוזי), Sauna (סאונה), Yoga/Pilates Studio, Co-working spaces"),
  amenitiesNo: z.array(z.enum(["Doorman", "Pool", "Gym", "Jacuzzi", "Sauna", "Yoga/Pilates Studio", "Co-working spaces"])).default([]).describe("Amenities the documents say the project does NOT have (no doorman, no pool); anything in neither list is asked of the agent"),
  description: z.string().nullish().default(null).describe("Two to four plain English sentences about the project. No numbers already captured in fields."),
});
const Output = z.object({
  project: Project.nullish().default(null).describe("The whole project (a building or development with several units for sale) when the documents describe one, with or without specific units listed; the first one when there are several"),
  projects: z.array(Project).default([]).describe("Every project when the documents describe more than one (a list of three projects in one file): each with its own facts, the first repeated from 'project'. Empty when there is one project or none."),
  apartments: z.array(Apartment).default([]),
  agent: z.object({ name: z.string().nullish().default(null), email: z.string().nullish().default(null), phone: z.string().nullish().default(null), company: z.string().nullish().default(null) }).nullish().default(null).describe("The agent or seller who sent the listing, if the message says"),
});
type Extracted = z.infer<typeof Output>;
type ExtractedApartment = Extracted["apartments"][number];

const FLOOR_PLANS = `
Floor plan decks (a developer's marketing PDF, one page per unit type, mostly drawings): read them as pictures. Each page is a unit type, usually with a small table: Building, Type (a code such as A, UA1, PH2), Floor, Rooms, Apartment Area (the internal m²), Balcony Area (the mirpeset m²), and the street. Make one apartment per unit type per building (not per page: the same type drawn on several floors is one apartment, with the floor range in the description). Its name is the project's name only (e.g. "Mophet Ra'anana"); the type code goes in degem (UA1, D, PH4, with the building letter when the project has several buildings, e.g. "B-PH4"); the sizes go in internalSqm and mirpesetSqm, never in the name. Two pages with the same code and different sizes are two units. Reading one plan page, the way Jonathan reads it (Mophet type UA7, Sep 23, 2026):
- Orientation: find the compass rose first; it can sit anywhere on the page (often the top left corner) and its north arrow is often turned, not straight up. Read where the N arrow points, then place every side of the apartment by that arrow: a mirpeset drawn on the top edge of a plan whose N arrow points to the upper left faces north and west. A side that sits between two cardinal directions gets both (a mirpeset toward the upper right with N straight up is ["North", "East"]; one toward the lower left is ["South", "West"]). The apartment's direction is every side of it that has windows or a mirpeset: an apartment whose mirpasot sit on the bottom and left edges of a north-up drawing faces south and west, so direction is ["South", "West"]. Never leave direction empty when a compass rose is drawn.
- The side table: Building, Type (the degem), Apartment Area (internalSqm), Balcony Area (every mirpeset together) and Floor ("Floor: 5" means floor 5; a span such as 1-6 goes in the description with the lowest floor in floor).
- Rooms: the big rooms badge ("5 Rooms") is rooms. Bedrooms are the rooms minus one (the living and kitchen area counts as a room); count the bathrooms into bathrooms: a bathroom is a small room drawn with a toilet (the bowl shape), a sink and a bathtub (a long rectangle, often with a tap end) or a shower (a square with a drain or diagonal); a toilet and sink with no tub or shower is a half bath (0.5); an en suite off a bedroom counts like any other; the mamad, the machsan and a laundry niche are not bathrooms. Type UA7 has two: one with a tub (the 246 / 160 room) and one with a shower by the bedrooms, so bathrooms is 2. Say in the description how many bedrooms and bathrooms there are.
- Dimensions: every space carries its inner size in centimetres as "width / length" (366 / 160 is 3.66 m by 1.60 m, 5.8 m²). Count the mirpasot: each hatched or planked outdoor area outside the walls is one mirpeset, its direction the side of the building it sits on, its size from its printed dimensions. The balcony area left over after the measured ones belongs to the mirpeset without dimensions (Balcony Area 45.7 with a 5.8 m² south mirpeset means the west mirpeset is 39.9 m²). The stated total is the truth: the mirpasot sizes must add up to it exactly, so put any difference on the unmeasured or largest one; knowing the total matters more than the exact split. Fill mirpasot with one entry per mirpeset (sqm and direction), mirpesetSqm with the total and mirpesetDirection with all their directions; mirpesetCount is how many.
- A mamad (the reinforced room: thick walls, a small window, a heavy door, marked ממ"ד) is mamad Yes when it is drawn.
- A private pool or jacuzzi drawn on a mirpeset is pool Yes on that unit. Storage (machsan) drawn, listed or priced gives machsan Yes with machsanSqm and machsanLocation; "no storage" gives machsan No.
Read all of this off the drawing even when the side table is silent; the drawing is the source. A price list page maps unit types (or apartment numbers) to prices: put the matching price on each unit; when a type has a range, use the lowest and say so in the description. The street and city on the plans (e.g. Eliezer Yafe St. is in Ra'anana) give the project's address. For every unit give planPage: the page number (as captioned) whose drawing is that unit's floor plan; the CRM cuts that page out and files it as the unit's floorplan. When the decks describe a project, fill the project too: name, developer, address, total units, stories, delivery.

Developers: a project often has two developers (יזמים) in a joint venture, e.g. a landowner with a capital partner; a website's "Developer & Architects" page names them. Put every developer in developerNames (lead first) and the lead in developerName; architects are not developers.

Websites: a project site's facts usually sit on one page ("The Complex", "The Project", "About"): site size, number of buildings, total apartments, residential floors, elevators, entrances, parking, shared spaces. Read every page given and fill the project's totalUnits, stories, amenities and description from them.

Amenities: put what the documents say the project has in amenities and what they say it lacks in amenitiesNo (no doorman, no pool). Anything in neither list is asked of the agent afterwards, so never guess either way.`;

const SYSTEM = `You read messages and documents about apartments for sale in Israel and fill in apartment tickets for RJL Israel.
Rules: one entry per distinct apartment or house, with kind set (a private house on its own plot is a house; anything inside a building is an apartment). A building with several units for sale is several apartments; a whole project description with no specific unit is a PROJECT only: fill project (one entry per project in projects when the documents describe several) and make no apartment entry for it. An apartment entry inside a project is made only for a unit type that has its own floor plan in the documents (give its planPage) or its own figures on a plan or price list (rooms with its size); a rooms range such as "4-6 rooms and penthouses" describes the project, not units). Only record what the documents state; leave a field null when it is not stated. Never use placeholders like TBD. Square metres: internal excludes the mirpeset (balcony); if only a total is given, put it in internalSqm and say so in the description. Prices in shekels; if a price is in dollars, convert only if the document gives the rate, else leave priceNis null and mention the dollar price in the description. Parking must be one of the allowed values. Direction is the apartment's air directions. Mamad is the safe room. The subject line is often stale; trust the body, the attachments and the photos. No dashes as punctuation in text you write.
Hebrew: most of what arrives is in Hebrew. Read it natively. Write every field value in English: cities and neighborhoods in their usual English spelling (ירושלים Jerusalem, תל אביב Tel Aviv, רעננה Ra'anana, הרצליה Herzliya, רחביה Rehavia, קטמון Katamon, בקעה Baka, ארנונה Arnona, טלביה Talbiya), streets and project names transliterated with the Hebrew in parentheses the first time. A neighborhood is its name alone (HaMea, Rehavia, Baka): never the city, never a direction with the city such as "south Ra'anana". Vocabulary: חדרים rooms (3.5 חדרים is 3.5 rooms), מ"ר or מטר square metres, מרפסת mirpeset (balcony), מרפסת שמש sun balcony, מרפסת סוכה a mirpeset that takes a sukka (sukka Yes), דירת גן garden apartment (its outdoor space is the garden, read it as the mirpeset fields), פנטהאוז penthouse, בריכה pool, גינה garden, ממ"ד mamad, מחסן machsan (storage), חניה parking (חניה כפולה two spots, בטור back to back, מקבילה side by side), קומה floor, קומת קרקע ground floor, מעלית elevator, קבלן or יזם developer, פרויקט project, יד ראשונה מקבלן yad rishona from the developer, יד שנייה second hand, לא גרו never occupied, משופצת renovated, שנת בניה year built, טופס 4 or מסירה delivery, כיווני אוויר air directions (צפון north, דרום south, מזרח east, מערב west), גובה תקרה ceiling height, מחיר or מבוקש asking price, ש"ח or ₪ shekels, מיליון million (4.2 מיליון is 4,200,000). Text pulled out of Hebrew PDFs sometimes arrives with the letters or words of a line in reverse order; read it in whichever direction makes sense. Photos of listings (Yad2, Madlan, agency flyers) carry the same fields: read the numbers off the image.`;

/** One file that came with the message: text if we could read it, the bytes when it is an image or a candidate floorplan. */
export type IntakeFile = { name: string; type: string | null; size: number; text?: string | null; bytes?: Uint8Array | null; pages?: number | null };
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
export type IntakeRow = { id: string; kind: "apartments" | "houses" | "projects"; name: string; degem?: string | null; line: string; price: string; missing: string[]; provided?: { label: string; value: string }[]; projectId?: string | null; projectName?: string | null };
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
  const isPdf = /\.pdf$/i.test(name) || (type ?? "").includes("pdf");
  const pages = isPdf ? await (await import("@/lib/pdf-images")).pdfPageCount(bytes).catch(() => null) : null;
  return { name, type, size: bytes.byteLength, text, bytes, pages };
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_PDF_BYTES = 30 * 1024 * 1024; // what one request may carry as a document
/** A PDF that is mostly drawings (a floor plan deck, a brochure): little text per page, or a plan/floor/type in its name. It has to be looked at, not read. */
const isVisualPdf = (f: IntakeFile) => {
  if (!f.bytes || f.bytes.byteLength > MAX_PDF_BYTES || !(/\.pdf$/i.test(f.name) || (f.type ?? "").includes("pdf"))) return false;
  const text = f.text ?? "";
  // by text per page when the page count is known (Oct 16, 2026: TID's nine-page Ra'anana deck had 570 characters a page and was
  // read as text, so its floor plans were never looked at); a page of prose runs to thousands
  const sparse = f.pages ? text.length / f.pages < 1000 : text.length < 600 * Math.max(1, Math.round(f.bytes.byteLength / 1_500_000));
  return sparse || /floor|plan|type|rooms|תכנית|קומה|מפרט|brochure|deck/i.test(f.name) || /Balcony Area|Apartment Area|שטח מכר|שטח דירה|שטח מרפסת/.test(text);
};

/** Merge what several calls read: every apartment once (by name), the fullest project, the first agent. */
function mergeExtracted(parts: Extracted[]): Extracted {
  const out: Extracted = { project: null, projects: [], apartments: [], agent: null };
  const seen = new Set<string>();
  for (const p of parts) {
    for (const a of p.apartments) {
      const k = `${a.name.trim().toLowerCase()}|${(a.degem ?? "").trim().toLowerCase()}|${a.rooms ?? ""}|${a.internalSqm ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.apartments.push(a);
    }
    if (p.project) out.project = out.project ? (Object.fromEntries(Object.entries(out.project).map(([k, v]) => [k, v ?? (p.project as Record<string, unknown>)[k] ?? null])) as Extracted["project"]) : p.project;
    for (const pr of p.projects ?? []) if (pr.name && !out.projects.some((x) => x.name && companyKey(x.name) === companyKey(pr.name!))) out.projects.push(pr);
    if (!out.agent && p.agent) out.agent = p.agent;
  }
  return out;
}

/** The deck a unit was read from and its rendered pages, so the unit's planPage can be cut out as its floorplan (Jonathan, Sep 23, 2026). */
type PlanSource = { name: string; pages: import("@/lib/pdf-images").PageImage[] };
const planSource = new WeakMap<object, PlanSource>();
async function renderDeck(d: IntakeFile): Promise<import("@/lib/pdf-images").PageImage[]> {
  try {
    const { renderPdfPages } = await import("@/lib/pdf-images");
    return await renderPdfPages(d.bytes!, { maxPages: 40, width: 1200 });
  } catch (e) {
    console.error("israel intake: could not render", d.name, String(e).slice(0, 160));
    return [];
  }
}
/** The page of the deck a unit's plan is drawn on, as an image for its Floorplan window. */
function planImageFor(a: ExtractedApartment): { bytes: Uint8Array; type: string; name: string } | null {
  const src = planSource.get(a);
  if (!src || !a.planPage) return null;
  const page = src.pages.find((p) => p.page === a.planPage);
  if (!page) return null;
  return { bytes: page.bytes, type: page.mediaType, name: `${src.name.replace(/\.pdf$/i, "")} p${page.page}.${page.mediaType === "image/png" ? "png" : "jpg"}` };
}
async function extract(subject: string | null, body: string, files: IntakeFile[]): Promise<Extracted> {
  const visual = files.filter(isVisualPdf);
  const rest = files.filter((f) => !visual.includes(f));
  if (!visual.length) return extractOnce(subject, body, files, []);
  // one deck per call (Claude reads up to about 30 MB of PDF at a time); the message and the readable files ride along each time
  const parts: Extracted[] = [];
  for (const deck of visual) {
    const pages = await renderDeck(deck);
    const part = await extractOnce(subject, body, rest, [deck], pages).catch((e) => { console.error("israel intake: deck failed", deck.name, String(e).slice(0, 200)); return { project: null, projects: [], apartments: [], agent: null } as Extracted; });
    for (const a of part.apartments) planSource.set(a, { name: deck.name, pages });
    parts.push(part);
  }
  if (rest.some((f) => f.text || f.bytes) && !visual.length) parts.push(await extractOnce(subject, body, rest, []));
  return mergeExtracted(parts);
}


async function extractOnce(subject: string | null, body: string, files: IntakeFile[], docs: IntakeFile[], rendered: import("@/lib/pdf-images").PageImage[] = []): Promise<Extracted> {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];
  const parts = [`Subject: ${subject ?? ""}`, `Message:\n${body.slice(0, 40_000)}`, ...files.filter((f) => f.text).map((f) => `Attachment ${f.name}:\n${(f.text ?? "").slice(0, 40_000)}`)];
  if (docs.length) parts.push(`The document${docs.length > 1 ? "s" : ""} attached below (${docs.map((d) => d.name).join(", ")}) ${docs.length > 1 ? "are" : "is"} a floor plan deck or brochure: look at the drawings, tables and compass rose on every page.`);
  content.push({ type: "text", text: parts.join("\n\n") });
  for (const d of docs) {
    const pages = rendered.length ? rendered : await renderDeck(d);
    if (pages.length) {
      content.push({ type: "text", text: `Document ${d.name}, ${pages.length} page${pages.length === 1 ? "" : "s"}, one picture per page:` });
      for (const p of pages) {
        content.push({ type: "text", text: `${d.name}, page ${p.page}:` });
        content.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: Buffer.from(p.bytes).toString("base64") } });
      }
    } else {
      content.push({ type: "text", text: `Document ${d.name}:` });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(d.bytes!).toString("base64") } });
    }
  }
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
  const { loadDataRules } = await import("@/lib/data-rules");
  const rules = await loadDataRules("IL").catch(() => [] as string[]);
  const system = `${SYSTEM}${FLOOR_PLANS}${rules.length ? `\n\nHouse rules for reading files (Settings > Data rules; follow every one):\n${rules.map((r) => "- " + r).join("\n")}` : ""}`;
  const res = await client.messages.create({ model: "claude-opus-5", max_tokens: 16_000, system, messages: [{ role: "user", content }] });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const raw = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = Output.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.error("israel intake: answer did not match the schema", parsed.error.issues.slice(0, 5));
  } catch (e) {
    console.error("israel intake: answer was not JSON", String(e).slice(0, 200));
  }
  return { project: null, projects: [], apartments: [], agent: null };
}

/** Asked only when they apply: the project on a yad rishona apartment, the renovation year on a second-hand unit, a ceiling per level on a duplex. */
function conditionalMissing(a: ExtractedApartment): string[] {
  const out: string[] = [];
  if (a.sellerType?.startsWith("Yad Rishona") && !a.projectName) out.push("Project name");
  if (a.sellerType?.startsWith("Second hand") && a.renovationYear == null) out.push("Year of renovation (or never renovated)");
  if (a.levels && a.levels > 1 && a.ceilingCms.length < a.levels) out.push(`Ceiling height for each of the ${a.levels} levels`);
  if (a.mirpasot.length > 1 && a.mirpasot.some((m) => !m.sukka)) out.push("Sukka balcony (yes, partial or no) for each mirpeset");
  const sukkaYes = (a.sukka && a.sukka !== "No") || a.mirpasot.some((m) => m.sukka && m.sukka !== "No");
  if (sukkaYes && a.sukkaSqm == null && !a.mirpasot.some((m) => m.sukkaSqm != null)) out.push("Sukka balcony area (m²)");
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
  if (key === "street") return !hasHouseNumber(a.street); // mappable or missing
  if (a.machsan === "No" && (key === "machsanSqm" || key === "machsanLocation")) return false; // asked unless there is no machsan (Oct 16, 2026)
  if (key === "machsan" && (a.machsan || a.machsanSqm != null || a.machsanLocation)) return false;
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

/** A company name boiled down for matching: parentheticals (the Hebrew) and punctuation dropped, case ignored. */
export const companyKey = (name: string) => name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(ltd|inc|llc|group|בע"מ|בעמ)\b/g, " ").replace(/\s+/g, " ").trim();
async function findOrCreateCompany(name: string | null, role: string) {
  const n = name?.trim();
  if (!n) return null;
  const exact = await prisma.ilCompany.findFirst({ where: { name: { equals: n, mode: "insensitive" } } });
  if (exact) return exact;
  // Sep 23, 2026: "Ramot Ba'ir" was made twice next to "Ramot Ba'ir (רמות בעיר)"; the same name with or without the Hebrew is one company
  const key = companyKey(n);
  if (key) {
    const all = await prisma.ilCompany.findMany({ select: { id: true, name: true, roles: true, createdAt: true }, orderBy: { createdAt: "asc" } });
    const same = all.find((c) => companyKey(c.name) === key);
    if (same) return prisma.ilCompany.findUnique({ where: { id: same.id } });
  }
  return prisma.ilCompany.create({ data: { name: n, roles: JSON.stringify([role]) } });
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

/** Every developer named, as company ids (lead first): the lead already found, the rest found or made as Sponsor (Yazam). Null when there is only the lead. */
async function developerIdsFor(names: string[], lead: { id: string } | null): Promise<string | null> {
  const ids: string[] = lead ? [lead.id] : [];
  for (const n of names) {
    const c = await findOrCreateCompany(n, "Sponsor (Yazam)");
    if (c && !ids.includes(c.id)) ids.push(c.id);
  }
  return ids.length > 1 ? JSON.stringify(ids) : null;
}
/** The unit's own plan page from the deck it was read from, when Claude pointed at one. */
async function attachPlanPage(a: ExtractedApartment, unitId: string, kind: "apartments" | "houses" = "apartments"): Promise<boolean> {
  const img = planImageFor(a);
  if (!img) return false;
  const data = { floorplan: Buffer.from(img.bytes), floorplanType: img.type, floorplanName: img.name };
  if (kind === "houses") await prisma.ilHouse.update({ where: { id: unitId }, data });
  else await prisma.ilApartment.update({ where: { id: unitId }, data });
  return true;
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
  // "street"/"st" and "urban renewal" words are filler too (Oct 16, 2026: "Hazon Ish Street Urban Renewal" was made again as "Hazon Ish Ra'anana urban renewal")
  return s.replace(/\b(the|project|projects|tower|towers|park|residence|residences|complex|phase|street|st|road|rd|urban|renewal|pinui|binui)\b/g, " ").replace(/\s+/g, " ").trim();
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
type UnitKey = { name: string; street?: string | null; city?: string | null; rooms?: number | null; internalSqm?: number | null; degem?: string | null };
/** Type codes match when equal, or when one names the building and the other does not ("A-UA7" and "UA7"); "A-D" and "B-D" are two units. */
const degemCode = (d: string) => d.trim().toUpperCase().replace(/\s+/g, "").replace(/–/g, "-");
function degemSame(x: string, y: string): boolean {
  const a = degemCode(x), b = degemCode(y);
  if (a === b) return true;
  const ma = a.match(/^([A-Z])-(.+)$/), mb = b.match(/^([A-Z])-(.+)$/);
  if (ma && mb) return false;
  return (ma ? ma[2] : a) === (mb ? mb[2] : b);
}
export function sameUnit(a: UnitKey, b: UnitKey): boolean {
  if (a.city && b.city && a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  const na = unitNumbers(a.name), nb = unitNumbers(b.name);
  if (na.size && nb.size && ![...na].some((n) => nb.has(n))) return false; // different unit numbers
  // two units of a building are two tickets: a different room count or a different size is a different unit (Mofet decks, Sep 23)
  if (a.degem && b.degem && !degemSame(a.degem, b.degem)) return false; // a different type code is a different unit
  if (a.rooms != null && b.rooms != null && a.rooms !== b.rooms) return false;
  if (a.internalSqm != null && b.internalSqm != null && Math.abs(a.internalSqm - b.internalSqm) > Math.max(2, 0.03 * b.internalSqm)) return false;
  const sized = a.rooms != null || b.rooms != null || a.internalSqm != null || b.internalSqm != null || Boolean(a.degem || b.degem);
  if (a.street && b.street && a.street.trim().toLowerCase() === b.street.trim().toLowerCase() && !sized) return true; // the same building, no unit facts on either side
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
  // the deal owner: whoever at RJL Israel or Liviem brought it in (the forwarder); a listing sent straight by an agent has none yet (Oct 16, 2026)
  const owner = input.sender?.email && /@(rjlcapadvisors|rjlequities|rjlisrael|liviemisrael)\.com$/i.test(input.sender.email) ? input.sender.email.toLowerCase() : null;
  // the team's instructions above a forwarded email decide what lists come back; one kind named for the units forces it
  const wants = senderIsInternal ? wantedKinds(input.body) : new Set<Kind>();
  if (wants.size && !wants.has("projects") && (wants.has("apartments") !== wants.has("houses"))) for (const a of extracted.apartments) a.kind = wants.has("houses") ? "house" : "apartment";
  if (wants.size === 2 && wants.has("projects") && (wants.has("apartments") !== wants.has("houses"))) for (const a of extracted.apartments) a.kind = wants.has("houses") ? "house" : "apartment";
  const first = extracted.apartments[0];
  const proj = extracted.project?.name
    ? extracted.project
    : wants.has("projects")
      ? { name: first?.projectName ?? (input.subject ?? "Project").replace(/^\s*(fwd?|re|fw)\s*:\s*/i, ""), developerName: first?.developerName ?? null, developerNames: first?.developerNames ?? [], street: first?.street ?? null, city: first?.city ?? null, neighborhood: first?.neighborhood ?? null, totalUnits: first?.buildingUnits ?? null, stories: first?.buildingStories ?? null, parkingSpaces: null, completionDate: first?.completionDate ?? null, pool: null, doorman: null, gym: null, description: null }
      : null;
  if (!extracted.apartments.length && !proj) {
    await mark("skipped: no apartment or house found");
    return { skipped: "no apartments" };
  }
  const agentCompany = await findOrCreateCompany(extracted.agent?.company ?? null, "Broker");
  const agent = await findOrCreateAgent(extracted.agent, senderIsInternal ? null : input.sender, agentCompany?.id ?? null);
  const rows: IntakeRow[] = [];
  const touchedProjects = new Set<string>();
  const fileNames = input.files.map((f) => f.name);
  const origin = `Created from ${input.channel === "WHATSAPP" ? "a WhatsApp message" : `an email to ${input.mailbox}`}${input.subject ? `: "${input.subject}"` : ""}${fileNames.length ? ` with ${fileNames.join(", ")}` : ""}`;
  // a floorplan among the files satisfies the Floorplan line when there is one unit to give it to
  const planFile = extracted.apartments.length === 1 && input.files.some((f) => (f.type ?? "").startsWith("image/") || f.type === "application/pdf" || /\.(png|jpe?g|webp|pdf)$/i.test(f.name));
  // the project ticket: the whole building or development, when the documents describe one or the team asked for it
  let projectRow: { id: string; name: string } | null = null;
  /** A project ticket from the extractor's project facts: made or updated, noted, its brochure attached, and a row for the reply. */
  const upsertProjectRow = async (proj: NonNullable<Extracted["project"]> & { name: string }): Promise<{ id: string; name: string }> => {
    const pname = stripDashes(proj.name).trim();
    const existing = await findProject(pname, proj.city, proj.street);
    const dev = await findOrCreateCompany(proj.developerName ?? null, "Sponsor (Yazam)");
    const devIds = await developerIdsFor(proj.developerNames ?? [], dev);
    const amen: string[] = "amenities" in proj && Array.isArray(proj.amenities) ? proj.amenities : [];
    const amenNo: string[] = ("amenitiesNo" in proj && Array.isArray(proj.amenitiesNo) ? proj.amenitiesNo : []).filter((x) => !amen.includes(x));
    const pdata = { name: pname, developerId: dev?.id ?? null, developerIds: devIds, street: proj.street ?? null, city: proj.city ?? null, neighborhood: cleanNeighborhood(proj.neighborhood, proj.city), totalUnits: proj.totalUnits ?? null, stories: proj.stories ?? null, parkingSpaces: proj.parkingSpaces ?? null, completionDate: proj.completionDate ?? null, amenities: amen.length ? JSON.stringify(amen) : null, amenitiesNo: amenNo.length ? JSON.stringify(amenNo) : null, pool: amen.includes("Pool") ? "Yes" : amenNo.includes("Pool") ? "No" : proj.pool ?? null, doorman: amen.includes("Doorman") ? "Yes" : amenNo.includes("Doorman") ? "No" : proj.doorman ?? null, gym: amen.includes("Gym") ? "Yes" : amenNo.includes("Gym") ? "No" : proj.gym ?? null, agentContactId: agent?.id ?? null, description: proj.description ? stripDashes(proj.description) : null, ownerEmail: owner };
    const made = existing ? await prisma.ilProject.update({ where: { id: existing.id }, data: fillFrom(pdata) }) : await prisma.ilProject.create({ data: { ...pdata, pendingApproval: true } });
    touchedProjects.add(made.id);
    await prisma.ilNote.create({ data: { projectId: made.id, body: existing ? origin.replace(/^Created from/, "Updated from") : origin } });
    if (!existing?.brochureType) await attachBrochure(input.files, made.id).catch(() => null);
    await pushProjectRow(made.id);
    return { id: made.id, name: made.name };
  };
  /** The reply's row for a project ticket (once), with what it still lacks. */
  const pushProjectRow = async (id: string) => {
    if (rows.some((r) => r.kind === "projects" && r.id === id)) return;
    const fresh = await prisma.ilProject.findUnique({ where: { id }, omit: { brochure: true } });
    if (!fresh) return;
    const { projectMissing } = await import("@/lib/israel");
    rows.push({ id, kind: "projects", projectId: id, name: fresh.name, line: [fresh.totalUnits ? `${fresh.totalUnits} units` : null, fresh.stories ? `${fresh.stories} stories` : null, [fresh.neighborhood, fresh.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: "", missing: projectMissing(fresh as unknown as Record<string, unknown>) });
  };
  if (proj?.name) projectRow = await upsertProjectRow(proj as NonNullable<Extracted["project"]> & { name: string });
  // the other projects of a multi-project email (Oct 15, 2026: one file described three Ra'anana projects; two of them had only project facts)
  for (const pr of extracted.projects ?? []) {
    if (!pr.name || (proj?.name && companyKey(pr.name) === companyKey(proj.name))) continue;
    await upsertProjectRow(pr as NonNullable<Extracted["project"]> & { name: string }).catch((e) => console.error("israel intake: project", pr.name, String(e).slice(0, 120)));
  }
  const mirpasot = (a: ExtractedApartment) => {
    const list = reconcileMirpasot(a.mirpesetSqm, a.mirpasot.filter((m) => m.sqm != null || m.direction.length || m.sukka).slice(0, 3));
    const total = list.length > 1 ? list.reduce((t, m) => t + (m.sqm ?? 0), 0) : null;
    const single = { sqm: a.mirpesetSqm ?? null, direction: a.mirpesetDirection, sukka: a.sukka ?? null, sukkaSqm: a.sukkaSqm ?? null, pool: null, poolSqm: null };
    return { mirpesetCount: list.length > 1 ? list.length : a.mirpesetSqm != null ? 1 : null, mirpesetSqm: a.mirpesetSqm ?? (total || null), mirpesetDirection: JSON.stringify(list.length > 1 ? [...new Set(list.flatMap((m) => m.direction))] : a.mirpesetDirection), mirpasot: JSON.stringify(list.length > 1 ? list : single.sqm != null || single.direction.length || single.sukka || single.pool ? [single] : []) };
  };
  const noPlan: string[] = []; // apartments with no floorplan: no ticket (Jonathan, Oct 16, 2026)
  for (const a of extracted.apartments) {
    const developer = await findOrCreateCompany(a.developerName, "Sponsor (Yazam)");
    const developerIds = await developerIdsFor(a.developerNames ?? [], developer);
    if (a.kind === "house") {
      let houseProject = null as { id: string } | null;
      if (a.projectName?.trim()) {
        houseProject = (await findProject(a.projectName.trim(), a.city)) ?? (await prisma.ilProject.create({ data: { name: a.projectName.trim(), developerId: developer?.id ?? null, street: a.street, city: a.city, neighborhood: cleanNeighborhood(a.neighborhood, a.city), completionDate: a.completionDate, pendingApproval: true, ownerEmail: owner } }));
      }
      const houseData = {
          name: stripDashes(a.name) || a.street || "House",
          houseType: a.houseType,
          projectId: houseProject?.id ?? projectRow?.id ?? null,
          street: a.street,
          city: a.city,
          neighborhood: cleanNeighborhood(a.neighborhood, a.city),
          developerId: developer?.id ?? null,
          developerIds,
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
          ownerEmail: owner,
      };
      const candidates = await prisma.ilHouse.findMany({ select: { id: true, name: true, street: true, city: true, rooms: true, internalSqm: true, floorplanType: true, extra: true } });
      const found = candidates.find((h) => sameUnit({ name: houseData.name, street: a.street, city: a.city, rooms: a.rooms, internalSqm: a.internalSqm }, h));
      const house = found
        ? await prisma.ilHouse.update({ where: { id: found.id }, data: { ...fillFrom(houseData), ...mergedExtra(found.extra, a.extra) } })
        : await prisma.ilHouse.create({ data: houseData });
      await prisma.ilNote.create({ data: { houseId: house.id, body: found ? origin.replace(/^Created from/, "Updated from") : origin } });
      const housePlan = !found?.floorplanType && (await attachPlanPage(a, house.id, "houses").catch(() => false));
      if (!housePlan && extracted.apartments.length === 1 && !(found?.floorplanType)) await attachFloorplan(input.files, house.id, "houses").catch(() => null);
      const { houseMissing } = await import("@/lib/israel");
      rows.push({ id: house.id, kind: "houses", projectId: houseData.projectId, projectName: a.projectName ?? null, name: house.name, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, a.migrashSqm ? `${sqm(a.migrashSqm)} migrash` : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: found ? houseMissing((await prisma.ilHouse.findUnique({ where: { id: house.id } })) as unknown as Record<string, unknown>) : missingForHouse(a, Boolean(developer), planFile || Boolean(planImageFor(a))) });
      continue;
    }
    let project = null as { id: string } | null;
    if (a.projectName?.trim()) {
      project = (await findProject(a.projectName.trim(), a.city)) ?? (await prisma.ilProject.create({ data: { name: a.projectName.trim(), developerId: developer?.id ?? null, street: a.street, city: a.city, neighborhood: cleanNeighborhood(a.neighborhood, a.city), stories: a.buildingStories, totalUnits: a.buildingUnits, completionDate: a.completionDate, pendingApproval: true, ownerEmail: owner } }));
    }
    // a unit inside a project gets a ticket only with its own floor plan or its own figures (rooms and size); a "unit" that is really
    // the project described (Pardes Meshutaf, Hazon Ish on Oct 13, 2026: an empty apartment each) stays project-level, its
    // building facts on the project ticket, unless the CRM already has that unit
    const pid = project?.id ?? projectRow?.id ?? null;
    const hasOwnPlan = Boolean(planImageFor(a)) || (extracted.apartments.length === 1 && planFile);
    // no floorplan, no apartment ticket (Jonathan, Oct 16, 2026: "the floorplan anchors our data"): on its own the listing is named in the
    // reply and skipped, unless the CRM already has the unit; under a project its building facts go to the project ticket
    if (!hasOwnPlan && !pid) {
      const all = await prisma.ilApartment.findMany({ select: { id: true, name: true, street: true, city: true, rooms: true, internalSqm: true, degem: true } });
      if (!all.some((x) => sameUnit({ name: stripDashes(a.name) || a.street || "Apartment", street: a.street, city: a.city, rooms: a.rooms, internalSqm: a.internalSqm, degem: a.degem }, x))) { noPlan.push(stripDashes(a.name) || a.street || "the apartment"); continue; }
    }
    if (pid && !hasOwnPlan) {
      const known = (await prisma.ilApartment.findMany({ where: { projectId: pid }, select: { id: true, name: true, street: true, city: true, rooms: true, internalSqm: true, degem: true } })).some((x) => sameUnit({ name: stripDashes(a.name) || a.street || "Apartment", street: a.street, city: a.city, rooms: a.rooms, internalSqm: a.internalSqm, degem: a.degem }, x));
      if (!known) {
        await prisma.ilProject.update({ where: { id: pid }, data: fillFrom({ developerId: developer?.id ?? null, street: a.street, city: a.city, neighborhood: cleanNeighborhood(a.neighborhood, a.city), stories: a.buildingStories, totalUnits: a.buildingUnits, completionDate: a.completionDate, description: a.description ? stripDashes(a.description) : null }) }).catch(() => null);
        touchedProjects.add(pid);
        await pushProjectRow(pid);
        continue;
      }
    }
    const aptData = {
        name: stripDashes(a.name) || a.street || "Apartment",
        apartmentType: a.apartmentType,
        degem: a.degem ?? null,
        street: a.street,
        city: a.city,
        neighborhood: cleanNeighborhood(a.neighborhood, a.city),
        projectId: project?.id ?? projectRow?.id ?? null,
        projectName: a.projectName,
        developerId: developer?.id ?? null,
        developerIds,
        agentContactId: agent?.id ?? null,
        rooms: a.rooms,
        bathrooms: a.bathrooms,
        completionDate: a.completionDate,
        floor: a.floor,
        totalFloors: a.buildingStories,
        buildingUnits: a.buildingUnits,
        internalSqm: a.internalSqm,
        ...mirpasot(a),
        levels: a.levels && a.levels > 1 ? Math.min(a.levels, 3) : null,
        ceilingCms: JSON.stringify(a.levels && a.levels > 1 ? a.ceilingCms : []),
        ceilingCm: a.ceilingCm ?? a.ceilingCms[0] ?? null,
        machsan: a.machsan ?? (a.machsanSqm != null || a.machsanLocation ? "Yes" : null),
        machsanSqm: a.machsanSqm,
        machsanLocation: a.machsanLocation && (IL_MACHSAN_LOCATIONS as readonly string[]).includes(a.machsanLocation) ? a.machsanLocation : null,
        parkingSpots: a.parkingSpots && (IL_PARKING as readonly string[]).includes(a.parkingSpots) ? a.parkingSpots : null,
        direction: JSON.stringify(a.direction),
        mamad: a.mamad ?? null,
        priceNis: a.priceNis,
        sellerType: a.sellerType ?? (project?.id || projectRow?.id ? "Yad Rishona (developer)" : null), // under a project ticket: from the developer (Jonathan, Oct 16, 2026)
        renovationYear: a.sellerType?.startsWith("Second hand") ? a.renovationYear : null,
        description: a.description ? stripDashes(a.description) : null,
        pool: a.pool ?? (a.mirpasot.some((m) => m.pool === "Yes") ? "Yes" : null),
        poolSqm: a.poolSqm ?? a.mirpasot.find((m) => m.poolSqm != null)?.poolSqm ?? null,
        extra: extraJson(a.extra),
        source: input.sourceLabel,
        sourceMessageId: input.key,
        pendingApproval: true,
        ownerEmail: owner,
    };
    const aptCandidates = await prisma.ilApartment.findMany({ select: { id: true, name: true, street: true, city: true, rooms: true, internalSqm: true, degem: true, floorplanType: true, extra: true } });
    const foundApt = aptCandidates.find((x) => sameUnit({ name: aptData.name, street: a.street, city: a.city, rooms: a.rooms, internalSqm: a.internalSqm, degem: a.degem }, x));
    const created = foundApt
      ? await prisma.ilApartment.update({ where: { id: foundApt.id }, data: { ...fillFrom(aptData), ...mergedExtra(foundApt.extra, a.extra) } })
      : await prisma.ilApartment.create({ data: aptData });
    await prisma.ilNote.create({ data: { apartmentId: created.id, body: foundApt ? origin.replace(/^Created from/, "Updated from") : origin } });
    const ownPlan = !foundApt?.floorplanType && (await attachPlanPage(a, created.id).catch(() => false));
    if (!ownPlan && extracted.apartments.length === 1 && !(foundApt?.floorplanType)) await attachFloorplan(input.files, created.id).catch(() => null);
    if (aptData.projectId) touchedProjects.add(aptData.projectId);
    rows.push({ id: created.id, kind: "apartments", projectId: aptData.projectId, projectName: a.projectName ?? null, name: created.name, degem: created.degem ?? a.degem ?? null, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: foundApt ? (await import("@/lib/israel")).apartmentMissing((await prisma.ilApartment.findUnique({ where: { id: created.id } })) as unknown as Record<string, unknown>) : missingFor(a, Boolean(developer), planFile || Boolean(planImageFor(a))) });
  }
  if (!rows.length && noPlan.length) {
    await mark("skipped: no floorplan");
    return { skipped: "no floorplan" };
  }
  // the project's building facts and developers flow to the units filed under it; the reply lists what is still missing after that
  for (const pid of touchedProjects) await syncProjectToUnits(pid).catch(() => null);
  if (touchedProjects.size) {
    const { apartmentMissing: am, houseMissing: hm } = await import("@/lib/israel");
    for (const r of rows) {
      if (r.kind === "apartments") { const row = await prisma.ilApartment.findUnique({ where: { id: r.id }, omit: { floorplan: true } }); if (row) r.missing = am(row as unknown as Record<string, unknown>); }
      if (r.kind === "houses") { const row = await prisma.ilHouse.findUnique({ where: { id: r.id }, omit: { floorplan: true } }); if (row) r.missing = hm(row as unknown as Record<string, unknown>); }
    }
  }
  // what each ticket now holds, item by item, so the reply can be checked against the email (Jonathan, Oct 13, 2026)
  {
    const { providedOn } = await import("@/lib/israel");
    for (const r of rows) {
      const row = r.kind === "apartments" ? await prisma.ilApartment.findUnique({ where: { id: r.id }, omit: { floorplan: true }, include: { developer: { select: { name: true } }, project: { select: { name: true } } } }) : r.kind === "houses" ? await prisma.ilHouse.findUnique({ where: { id: r.id }, omit: { floorplan: true }, include: { developer: { select: { name: true } } } }) : await prisma.ilProject.findUnique({ where: { id: r.id }, omit: { brochure: true } });
      if (!row) continue;
      const rec = row as unknown as Record<string, unknown> & { developer?: { name: string } | null; project?: { name: string } | null };
      r.provided = providedOn(r.kind, { ...rec, developerName: rec.developer?.name ?? rec.developerName, projectName: rec.project?.name ?? rec.projectName });
    }
  }
  await mark(`created ${rows.length}`);
  const note = agent ? `Agent on file: ${[agent.firstName, agent.lastName].filter(Boolean).join(" ") || agent.email || agent.phone}.` : null;
  // whatever the project knows (units, stories, delivery) fills blanks on the units filed under it
  if (projectRow) await (await import("@/app/israel/actions")).syncProjectToUnits(projectRow.id).catch(() => null);
  const planNote = noPlan.length ? `No floorplan for ${noPlan.join(", ")}, so no apartment ticket was made; send the plan and it will be read.` : null;
  const asked = [...wants].filter((k) => !rows.some((r) => r.kind === k));
  const askedNote = asked.length ? `You asked for ${asked.map((k) => (k === "projects" ? "a project" : k === "houses" ? "a house" : "an apartment")).join(" and ")} list too, but the documents describe none; send the material or add it by hand.` : null;
  return { rows, note: [note, planNote, askedNote].filter(Boolean).join(" ") || null };
}

export const appBase = () => (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");

/** A unit line without its location (rooms, size, migrash): the location is said once, above the units. */
const unitFacts = (line: string) => line.split(" · ").filter((x) => /rooms|m²|migrash/.test(x)).join(" · ");
/** What tells one unit of a batch from another in the reply: the type code (degem), else the name with its rooms and size. */
const unitTag = (r: IntakeRow) => r.degem?.trim() || [r.name, r.line].filter(Boolean).join(", ");
/**
 * The missing items of several units of one batch, grouped by item (Jonathan, Sep 23, 2026): "Floorplan (missing for
 * A-D, A-J)" rather than the same list under every unit. An item every unit lacks says so. Items keep the order of the
 * Required Items list (first appearance).
 */
function groupedMissing(units: IntakeRow[]): { item: string; tags: string[]; all: boolean; who: string }[] {
  const order: string[] = [];
  const by = new Map<string, string[]>();
  for (const r of units) for (const m of r.missing) {
    if (!by.has(m)) { by.set(m, []); order.push(m); }
    by.get(m)!.push(unitTag(r));
  }
  return order.map((item) => {
    const tags = by.get(item)!;
    const all = tags.length === units.length && units.length > 1;
    const except = units.map(unitTag).filter((t) => !tags.includes(t));
    // "all 23 units", "all but A-J, A-UA1", or the units named
    const who = all ? `all ${units.length} units` : units.length > 4 && except.length <= 3 ? `all but ${except.join(", ")}` : `missing for ${tags.join(", ")}`;
    return { item, tags, all, who };
  });
}
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
type SheetPage = import("@/lib/israel-request-pdf").RequestPage;
function replyHtml(rows: IntakeRow[], base: string, note: string | null, skippedFiles: string[] = [], pages: SheetPage[] = []): string {
  // Oct 16, 2026: one block per sheet (a project with its units, or a batch of units), the ticket links, and what was received
  // in one grey line each; the sheets carry only what is needed
  const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const grey = 'style="color:#6b716e;"';
  const byId = new Map(rows.map((r) => [r.id, r]));
  const status = (r: IntakeRow) => (r.missing.length ? `<span ${grey}>${r.missing.length} needed</span>` : `<span ${grey}>complete</span>`);
  const link = (r: IntakeRow) => `<a href="${base}/israel/${r.kind}/${r.id}">${esc(r.name)}</a>`;
  const unitLine = (r: IntakeRow) => `<li>${link(r)}${r.degem ? ` <span ${grey}>type ${esc(r.degem)}</span>` : ""}${r.kind === "houses" ? ` <span ${grey}>(house)</span>` : ""}${unitFacts(r.line) ? ` <span ${grey}>${esc(unitFacts(r.line))}</span>` : ""} · ${status(r)}</li>`;
  const short = (label: string) => label.replace(/\s*\(.*$/, "").replace(/:\s*$/, "");
  const receivedLine = (pg: SheetPage) => {
    const parts = pg.sections.map((sec) => { const got = sec.items.filter((it) => !it.needed).map((it) => `${esc(short(it.label))}${it.value ? `: ${esc(it.value)}` : ""}`); return got.length ? `<b>${sec.heading.startsWith("Project") ? "Project" : sec.heading.startsWith("House") ? "Houses" : "Apartments"}</b> ${got.join(" · ")}` : null; }).filter(Boolean);
    return parts.length ? `<div style="margin:2pt 0 0 18pt;color:#6b716e;font-size:9.5pt;line-height:1.35;">Received: ${parts.join("<br>")}</div>` : "";
  };
  const placed = new Set<string>();
  const blocks = pages.map((pg) => {
    const here = (pg.ids ?? []).map((id) => byId.get(id)).filter((r): r is IntakeRow => Boolean(r));
    here.forEach((r) => placed.add(r.id));
    const project = here.find((r) => r.kind === "projects");
    const units = here.filter((r) => r.kind !== "projects");
    const head = project ? `<b>${link(project)}</b>${project.line ? ` <span ${grey}>${esc(project.line)}</span>` : ""} · ${status(project)}` : `<b>${esc(pg.title)}</b>`;
    return `<p style="margin:8pt 0 2pt 0;">${head}</p>${units.length ? `<ul style="margin:0 0 2pt 18pt;">${units.map(unitLine).join("")}</ul>` : project ? `<div style="margin:0 0 2pt 18pt;color:#6b716e;">no unit on file yet</div>` : ""}${receivedLine(pg)}`;
  });
  const rest = rows.filter((r) => !placed.has(r.id));
  if (rest.length) blocks.push(`<ul style="margin:8pt 0 4pt 18pt;">${rest.map(unitLine).join("")}</ul>`);
  return `<div style="${font}">
<p>${rows.length === 1 ? `${kindWord(rows[0].kind)} ticket updated in` : `${rows.length} tickets updated in`} RJL Israel. Attached: ${pages.length === 1 ? "an Items Needed sheet" : `one Items Needed sheet per project (${pages.length})`}, and the files you forwarded, to compare.</p>
${blocks.join("")}
${note ? `<p ${grey}>${esc(note)}</p>` : ""}
<p style="color:#6b716e;font-size:9pt;">Everything waits in The Que until approved. Reply to the agent with the sheet and forward the answer here; edit anything on the ticket in the CRM.${skippedFiles.length ? ` Not attached again (too large): ${skippedFiles.map(esc).join(", ")}.` : ""}</p>
</div>`;
}

/** The same reply as plain text, for WhatsApp. */
export function replyText(rows: IntakeRow[], base: string, note: string | null): string {
  const lines = [rows.length === 1 ? `${kindWord(rows[0].kind)} ticket created in RJL Israel.` : `${rows.length} tickets created in RJL Israel.`];
  const projects = rows.filter((r) => r.kind === "projects");
  const units = rows.filter((r) => r.kind !== "projects");
  const one = (r: IntakeRow) => {
    lines.push("", `*${r.name}*${r.degem ? ` type ${r.degem}` : ""}${r.kind !== "apartments" ? ` (${r.kind === "houses" ? "house" : "project"})` : ""}${r.line ? ` · ${r.line}` : ""}${r.price ? ` · ${r.price}` : ""}`, `${base}/israel/${r.kind}/${r.id}`);
  };
  for (const r of projects) { one(r); lines.push(r.missing.length ? `Still missing: ${r.missing.join(", ")}` : "Nothing missing, the ticket is complete."); }
  if (units.length <= 1) for (const r of units) { one(r); lines.push(r.missing.length ? `Still missing: ${r.missing.join(", ")}` : "Nothing missing, the ticket is complete."); }
  else {
    for (const r of units) one(r);
    const groups = groupedMissing(units);
    lines.push("", groups.length ? "Still needed across the units:" : "Nothing missing, every unit is complete.");
    for (const g of groups) lines.push(`- ${g.item} (${g.who})`);
  }
  if (rows.some((r) => r.missing.length)) lines.push("", "Everything waits in The Que until approved.");
  if (note) lines.push(note);
  return lines.join("\n");
}
export const NO_PLAN_TEXT = "The listing has no floorplan, so no apartment ticket was made: a floorplan anchors every apartment ticket and carries most of what we need. Send the plan (a picture or PDF) and it will be read; a project described without plans gets a project ticket.";
export const NO_APARTMENT_TEXT = "I could not find an apartment or a house in this message or its files, so no ticket was created. Send the listing with the details (address, size, price) or add it by hand under Apartments or Houses in RJL Israel.";

/** Jonathan is copied on every reply the Israel deals mailbox sends, so he sees each deal as it comes in (Sep 23, 2026). ISRAEL_REPLY_CC overrides; empty turns it off. */
const REPLY_CC = () => (process.env.ISRAEL_REPLY_CC ?? "jonathan@rjlisrael.com").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@"));

async function replyOnThread(msg: Msg, html: string, attachments: { name: string; contentType: string; bytes: Uint8Array }[] = []) {
  const draft = await graph<{ id: string }>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(msg.id)}/createReply`, { method: "POST", body: JSON.stringify({}) });
  const sender = msg.from?.emailAddress.address?.toLowerCase() ?? "";
  const to = sender ? [{ emailAddress: { address: sender } }] : [];
  const cc = REPLY_CC().filter((x) => x !== sender).map((address) => ({ emailAddress: { address } }));
  await graph(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(draft.id)}`, { method: "PATCH", body: JSON.stringify({ body: { contentType: "html", content: html }, toRecipients: to, ccRecipients: cc }) });
  const { addAttachment } = await import("@/lib/graph");
  for (const a of attachments) await addAttachment(ISRAEL_MAILBOX(), draft.id, a).catch((e) => console.error("israel reply attachment failed", a.name, e));
  await graph(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(draft.id)}/send`, { method: "POST" });
}

/**
 * "Unit types (degamim)": a range of rooms in the material ("4-6 rooms and penthouses") means at least that many unit
 * types; when fewer are on file, the full list of types is asked for as one item (Jonathan, Oct 15, 2026).
 */
export function degamimAsk(text: string, have: number): string | null {
  const m = text.match(/(\d(?:\.5)?)\s*(?:-|–|to|עד)\s*(\d(?:\.5)?)\s*(?:rooms?|bedrooms?|חדרים|חד['׳]?)/i);
  if (!m) return null;
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!(hi > lo) || hi - lo > 6) return null;
  const pent = /penthouse|פנטהאו[זס]/i.test(text);
  const n = Math.floor(hi - lo) + 1 + (pent ? 1 : 0);
  if (n <= have) return null;
  return `Unit types (degamim): the material mentions ${m[1]} to ${m[2]} rooms${pent ? " and penthouses" : ""}, so at least ${n} unit types; ${have ? `${have} on file` : "none on file"}. Every type with its own details is needed`;
}
/** A project's key for finding it in the text: its first distinctive words, parentheticals (the Hebrew) dropped. */
const nameKey = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").trim().split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(" ").toLowerCase();
/**
 * The part of the material about one project: from its name to the next project's name (so a rooms range under one
 * project never reads as another's), or the whole text when the name is not found and it is the only project.
 */
function textNear(all: string, name: string, others: string[], only: boolean): string {
  const low = all.toLowerCase();
  const key = nameKey(name);
  const i = key ? low.indexOf(key) : -1;
  if (i < 0) return only ? all : "";
  let end = Math.min(all.length, i + 4000);
  for (const o of others) {
    const k = nameKey(o);
    if (!k || k === key) continue;
    let j = low.indexOf(k, i + key.length);
    while (j >= 0 && j < end) { end = j; j = -1; }
  }
  return all.slice(i, end); // from the name on: a look-back read the previous project's rooms range as this one's
}

/**
 * The request sheet's pages: one per project with the units filed under it, then one per batch of units with no
 * project ticket. Each page lists every item of the Required Items List once: needed in bold (any unit lacking it), found in
 * regular (every unit has it), items that do not apply left out.
 */
export function requestPages(rows: IntakeRow[], allText: string): import("@/lib/israel-request-pdf").RequestPage[] {
  type Section = import("@/lib/israel-request-pdf").RequestSection;
  type Page = import("@/lib/israel-request-pdf").RequestPage;
  const projects = rows.filter((r) => r.kind === "projects");
  const units = rows.filter((r) => r.kind !== "projects");
  const amenityLine = (m: string) => /\(yes or no\)$/.test(m) && (IL_AMENITIES as readonly string[]).some((a) => m.startsWith(a));
  const projectSection = (p: IntakeRow): Section => {
    const items: { label: string; value?: string | null; needed: boolean }[] = [];
    const listed = new Set<string>();
    for (const { key, label } of IL_REQUIRED.projects) {
      listed.add(label);
      const value = p.provided?.find((x) => x.label === label)?.value ?? null;
      if (p.missing.includes(label)) items.push({ label, needed: true });
      else if (key === "amenities" && p.missing.some(amenityLine)) {
        const open = p.missing.filter(amenityLine).map((m) => m.replace(/ \(yes or no\)$/, ""));
        items.push({ label: open.length >= IL_AMENITIES.length ? label : `${label}: still to answer ${open.join(", ")}${value ? ` (answered: ${value})` : ""}`, needed: true });
      }
      else if (value) items.push({ label, value, needed: false });
    }
    for (const m of p.missing) if (!listed.has(m) && !amenityLine(m)) items.push({ label: m, needed: true });
    return { heading: "Project Level Information Needed", items };
  };
  // on a project's page, what the Project section already asks is not asked again under its units (Jonathan, Oct 15, 2026:
  // "if we are asking for building stories on the project level, we won't need it on the unit level")
  const PROJECT_LEVEL: Record<string, string> = { developerId: "developerId", street: "street", city: "city", neighborhood: "neighborhood", totalFloors: "stories", buildingUnits: "totalUnits", completionDate: "completionDate" };
  // a unit under a project ticket is yad rishona from the developer by definition, so the seller type is never asked there (Jonathan, Oct 16, 2026)
  const coveredByProject = (key: string) => key === "sellerType" || Boolean(PROJECT_LEVEL[key] && IL_REQUIRED.projects.some((i) => i.key === PROJECT_LEVEL[key]));
  const unitSection = (list: IntakeRow[], kind: "apartments" | "houses", nearText: string, underProject = false): Section => {
    const items: { label: string; value?: string | null; needed: boolean }[] = [];
    const ask = kind === "apartments" ? degamimAsk(nearText, list.length) : null;
    if (ask) items.push({ label: ask, needed: true });
    const listed = new Set<string>();
    for (const { key, label } of IL_REQUIRED[kind]) {
      listed.add(label);
      if (underProject && coveredByProject(key)) continue;
      const needed = list.length === 0 || list.some((u) => u.missing.includes(label));
      if (needed) { items.push({ label, needed: true }); continue; }
      const values = list.map((u) => u.provided?.find((x) => x.label === label)?.value ?? null);
      if (!values.every(Boolean)) continue; // applies to no unit (no machsan, no mirpeset): not asked, not found
      const same = values.every((v) => v === values[0]);
      items.push({ label, value: same ? values[0] : "per unit, see the tickets", needed: false });
    }
    for (const m of [...new Set(list.flatMap((u) => u.missing))]) if (!listed.has(m)) items.push({ label: m, needed: true });
    const word = kind === "houses" ? "Houses" : "Apartments";
    // the unit's own facts only (type, rooms, size, price): the location is on the page already (Jonathan, Oct 15, 2026)
    // a type code that is itself the rooms ("4 rooms") is not followed by "4 rooms" again
    const facts = (u: IntakeRow) => (u.degem && /rooms/i.test(u.degem) ? unitFacts(u.line).split(" · ").filter((x) => !/rooms/.test(x)).join(" · ") : unitFacts(u.line));
    const lead = list.slice(0, 8).map((u) => [u.degem ? `Type ${u.degem}` : list.length > 1 ? u.name : null, facts(u) || null, u.price || null].filter(Boolean).join(" · ")).filter(Boolean);
    if (list.length > 8) lead.push(`and ${list.length - 8} more`);
    const heading = kind === "houses" ? "House Level Information Needed (Per House)" : "Apartment Level Information Needed (Per Unit Type)";
    return { heading, lead: list.length ? [`${list.length} ${list.length === 1 ? (kind === "houses" ? "house" : "unit type") : kind === "houses" ? "houses" : "unit types"} on file`, ...lead] : [`No ${word.toLowerCase()} on file yet: everything below is needed.`], items };
  };
  const pages: Page[] = [];
  const used = new Set<string>();
  for (const p of projects) {
    const mine = units.filter((u) => u.projectId === p.id);
    mine.forEach((u) => used.add(u.id));
    const near = textNear(allText, p.name, projects.map((x) => x.name), projects.length === 1);
    const sections: Section[] = [projectSection(p)];
    const apts = mine.filter((u) => u.kind === "apartments"), houses = mine.filter((u) => u.kind === "houses");
    if (apts.length || !houses.length) sections.push(unitSection(apts, "apartments", near, true));
    if (houses.length) sections.push(unitSection(houses, "houses", near, true));
    pages.push({ title: p.name, subtitle: p.line || null, sections, ids: [p.id, ...mine.map((u) => u.id)] });
  }
  const rest = units.filter((u) => !used.has(u.id));
  const groups = new Map<string, IntakeRow[]>();
  for (const u of rest) { const k = `${u.kind}|${u.projectId ?? u.projectName ?? ""}`; groups.set(k, [...(groups.get(k) ?? []), u]); }
  for (const [k, list] of groups) {
    const kind = k.startsWith("houses") ? "houses" : "apartments";
    const pname = list[0].projectName?.trim() || null;
    const title = pname ?? (list.length === 1 ? list[0].name : kind === "houses" ? "Houses" : "Apartments");
    pages.push({ title, subtitle: list.length === 1 ? list[0].line || null : [list[0].line.split(" · ").slice(-1)[0] || null].filter(Boolean).join("") || null, sections: [unitSection(list, kind, pname ? textNear(allText, pname, [...projects.map((x) => x.name), ...[...groups.values()].map((l) => l[0].projectName ?? "")], groups.size === 1 && !projects.length) : allText)], ids: list.map((u) => u.id) });
  }
  return pages;
}

/** The forwarded files, attached again (those read as bytes, up to 20 MB in all); the rest are named in the reply. */
function filesToReattach(files: IntakeFile[]): { atts: { name: string; contentType: string; bytes: Uint8Array }[]; skipped: string[] } {
  const atts: { name: string; contentType: string; bytes: Uint8Array }[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const f of files) {
    if (!f.bytes || /^Website /.test(f.name)) continue;
    if (total + f.bytes.byteLength > 20 * 1024 * 1024) { skipped.push(f.name); continue; }
    total += f.bytes.byteLength;
    atts.push({ name: f.name, contentType: f.type ?? "application/octet-stream", bytes: f.bytes });
  }
  for (const f of files) if (!f.bytes && !/^Website /.test(f.name) && !skipped.includes(f.name)) skipped.push(f.name);
  return { atts, skipped };
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
  // OneDrive / SharePoint / Dropbox / Google Drive / Box links in the email: their documents count as attachments
  // (Jonathan's Mofet email on Sep 23 carried a OneDrive folder and nothing else, and the intake read only the text)
  const { findCloudLinks, fetchCloudFiles } = await import("@/lib/cloud-links");
  const cloud = await fetchCloudFiles(findCloudLinks(msg.body?.content, bodyText)).catch(() => ({ files: [], notes: [] as string[] }));
  for (const cf of cloud.files) {
    if (files.some((x) => x.name.toLowerCase() === cf.name.toLowerCase())) continue;
    files.push(await describeFile(cf.name, cf.contentType, cf.bytes).catch(() => ({ name: cf.name, type: cf.contentType, size: cf.size })));
  }
  // a project website in the email: its pages (and the ones about units, plans and prices) are read like attachments (Jonathan, Sep 23)
  const { findWebLinks, fetchWebPages } = await import("@/lib/web-pages");
  const sites = await fetchWebPages(findWebLinks(msg.body?.content, bodyText)).catch(() => [] as import("@/lib/web-pages").WebPage[]);
  for (const pg of sites) files.push({ name: `Website ${pg.title ? `"${pg.title}" ` : ""}${pg.url}`, type: "text/html", size: pg.text.length, text: pg.text });
  const linkNotes = [...cloud.notes.map((n) => n.replace(/^OneDrive folder had no/, "The OneDrive folder had no")), sites.length ? `Read ${sites.length} web page${sites.length === 1 ? "" : "s"} from the email's links.` : null].filter(Boolean).join(" ");
  const r = await intakeApartments({ channel: "EMAIL", key, subject: msg.subject, body: bodyText, files, sender: { name: msg.from?.emailAddress.name, email: from || null }, sourceLabel: `Email from ${msg.from?.emailAddress.name ?? from}`, mailbox: ISRAEL_MAILBOX() });
  // the reply always goes; when Microsoft refuses it, it is kept and sent on the next inbox pass
  const send = async (html: string, attachments: { name: string; contentType: string; bytes: Uint8Array }[] = []) => {
    try {
      await replyOnThread(msg, html, attachments);
      await prisma.ilInbound.updateMany({ where: { messageId: key }, data: { pendingReply: null, graphId: msg.id } }).catch(() => null);
    } catch (e) {
      console.error("israel intake reply failed", e);
      await prisma.ilInbound.updateMany({ where: { messageId: key }, data: { pendingReply: html, graphId: msg.id } }).catch(() => null);
    }
  };
  if ("skipped" in r) {
    if (r.skipped === "no apartments" || r.skipped === "no floorplan") await send(`<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;"><p>${r.skipped === "no floorplan" ? NO_PLAN_TEXT : NO_APARTMENT_TEXT}</p>${linkNotes ? `<p style="color:#6b716e;">${linkNotes}</p>` : ""}</div>`);
    return r;
  }
  // the request sheet (one page per project with its apartments, on RJL Israel letterhead) and the forwarded files, attached again
  const again = filesToReattach(files);
  const allText = [bodyText, ...files.map((x) => x.text ?? "")].join("\n\n");
  const pages = requestPages(r.rows, allText);
  const sheets: { name: string; contentType: string; bytes: Uint8Array }[] = [];
  try {
    const { buildIsraelRequestPdf, requestFileName } = await import("@/lib/israel-request-pdf");
    const date = new Date(msg.receivedDateTime ?? Date.now());
    for (const pg of pages) sheets.push({ name: requestFileName(pg.title, date), contentType: "application/pdf", bytes: await buildIsraelRequestPdf([pg], { subject: msg.subject, from: msg.from?.emailAddress.name ?? from, date }) });
  } catch (e) {
    console.error("israel request sheet failed", e);
  }
  await send(replyHtml(r.rows, appBase(), [r.note, linkNotes].filter(Boolean).join(" ") || null, again.skipped, pages), [...sheets, ...again.atts]);
  return { apartments: r.rows.length };
}

/** Replies Microsoft refused earlier go out now. */
async function sendPendingReplies(): Promise<number> {
  const pending = await prisma.ilInbound.findMany({ where: { pendingReply: { not: null }, graphId: { not: null } }, take: 10 });
  let sent = 0;
  for (const p of pending) {
    try {
      const msg = await graph<Msg>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(p.graphId!)}?$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,from,body`);
      await replyOnThread(msg, p.pendingReply!);
      await prisma.ilInbound.update({ where: { id: p.id }, data: { pendingReply: null } });
      sent++;
    } catch (e) {
      console.error("israel pending reply failed", p.messageId, e);
    }
  }
  return sent;
}

export async function processIsraelInbox(): Promise<{ processed: number; skipped: number } | { skipped: string }> {
  if (!graphConfigured()) return { skipped: "Graph not configured" };
  const r = await graph<{ value: Msg[] }>(`/users/${q(ISRAEL_MAILBOX())}/mailFolders/inbox/messages?$top=25&$orderby=receivedDateTime desc&$select=id,internetMessageId,from`).catch((e) => ({ error: String(e) }) as { value?: Msg[]; error?: string });
  if (!("value" in r) || !r.value) return { skipped: `mailbox unreachable: ${(r as { error?: string }).error ?? "unknown"}` };
  await sendPendingReplies().catch(() => 0);
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
