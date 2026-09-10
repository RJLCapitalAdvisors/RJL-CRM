import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";
import { attachmentToText, emailHtmlToText } from "@/lib/attachments";
import { IL_MACHSAN_LOCATIONS, IL_PARKING, nis, pricePerMeter, sqm } from "@/lib/israel";
import { stripDashes } from "@/lib/style";

/**
 * The deals@rjlisrael mailbox. Every new email there describes one or more apartments (from an agent, a developer,
 * a listing forward). We read the email and its attachments, pull every apartment into its own ticket with what
 * the documents state, link project, developer and agent, and reply on the thread with the tickets and what is
 * still missing on each. Each message is processed once (IlInbound.messageId).
 */
export const ISRAEL_MAILBOX = () => process.env.ISRAEL_DEALS_MAILBOX ?? "deals@rjlisrael.com";
const INTERNAL = /@(rjlcapadvisors|rjlequities|rjlisrael)\.com$/i;
const q = (s: string) => encodeURIComponent(s);
type Msg = { id: string; internetMessageId?: string; subject: string | null; receivedDateTime: string; hasAttachments?: boolean; from?: { emailAddress: { address: string; name?: string } }; body?: { contentType: string; content: string } };
type Att = { "@odata.type": string; id: string; name: string; contentType: string | null; size: number; isInline: boolean };

const Apartment = z.object({
  name: z.string().describe("Short name: project or street plus apartment number, e.g. 'Rehavia Gardens, Apt 12'"),
  projectName: z.string().nullable(),
  developerName: z.string().nullable(),
  street: z.string().nullable().describe("Building address, street and number"),
  city: z.string().nullable(),
  neighborhood: z.string().nullable(),
  rooms: z.number().nullable(),
  completionDate: z.string().nullable().describe("Year built for an existing building, or expected delivery as MM/YYYY for a new build"),
  floor: z.number().nullable(),
  buildingStories: z.number().nullable(),
  buildingUnits: z.number().nullable(),
  internalSqm: z.number().nullable().describe("Internal square metres, excluding the mirpeset"),
  mirpesetSqm: z.number().nullable(),
  ceilingCm: z.number().nullable(),
  machsanSqm: z.number().nullable(),
  machsanLocation: z.enum(["Attached to apartment", "In basement"]).nullable(),
  parkingSpots: z.enum(["None", "1", "2 - back to back", "2 side by side", "3"]).nullable(),
  direction: z.array(z.enum(["North", "South", "East", "West"])),
  mirpesetDirection: z.array(z.enum(["North", "South", "East", "West"])),
  mamad: z.boolean().nullable(),
  priceNis: z.number().nullable().describe("Asking price in shekels. Convert only if the document states a currency and an amount; never guess."),
  sellerType: z.enum(["Yad Rishona (developer)", "Second hand, never occupied", "Second hand, occupied"]).nullable().describe("Yad rishona means bought from the developer; second hand is a resale, occupied or never lived in"),
  renovationYear: z.number().nullable().describe("Year of the last renovation, second hand only"),
  description: z.string().nullable().describe("Two to four plain sentences about the apartment from the documents. No prices or numbers already captured in fields."),
});
const Output = z.object({
  apartments: z.array(Apartment),
  agent: z.object({ name: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), company: z.string().nullable() }).nullable().describe("The agent or seller who sent the listing, if the email says"),
});
type Extracted = z.infer<typeof Output>;

const SYSTEM = `You read emails and attachments about apartments for sale in Israel and fill in apartment tickets for RJL Israel.
Rules: one entry per distinct apartment (a building with several units for sale is several apartments; a whole project description with no specific unit is one apartment named after the project with the unit fields blank). Only record what the documents state; leave a field null when it is not stated. Never use placeholders like TBD. Square metres: internal excludes the mirpeset (balcony); if only a total is given, put it in internalSqm and say so in the description. Prices in shekels; if a price is in dollars, convert only if the document gives the rate, else leave priceNis null and mention the dollar price in the description. Parking must be one of the allowed values. Direction is the apartment's air directions. Mamad is the safe room. The subject line is often stale; trust the body and the attachments. No dashes as punctuation in text you write.`;

async function readAttachments(messageId: string): Promise<{ names: string[]; texts: { name: string; text: string }[] }> {
  const r = await graph<{ value: Att[] }>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
  const names: string[] = [];
  const texts: { name: string; text: string }[] = [];
  for (const a of r.value) {
    if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    names.push(a.name);
    if (a.size > 25 * 1024 * 1024) continue;
    const bytes = new Uint8Array(await graph<ArrayBuffer>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}/attachments/${q(a.id)}/$value`, { raw: true }));
    const text = await attachmentToText(a.name, a.contentType, bytes).catch(() => null);
    if (text) texts.push({ name: a.name, text });
  }
  return { names, texts };
}

async function extract(subject: string | null, body: string, atts: { name: string; text: string }[]): Promise<Extracted> {
  const client = new Anthropic();
  const parts = [`Subject: ${subject ?? ""}`, `Email:\n${body.slice(0, 40_000)}`, ...atts.map((a) => `Attachment ${a.name}:\n${a.text.slice(0, 40_000)}`)];
  const res = await client.messages.parse({ model: "claude-opus-5", max_tokens: 12_000, system: SYSTEM, messages: [{ role: "user", content: parts.join("\n\n") }], output_config: { format: zodOutputFormat(Output) } });
  return res.parsed_output ?? { apartments: [], agent: null };
}

/** What Jonathan wants on every ticket, in his order; the reply lists whichever are still blank. */
const REQUIRED: { key: keyof Extracted["apartments"][number] | "developer"; label: string }[] = [
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
function missingFor(a: Extracted["apartments"][number], hasDeveloper: boolean): string[] {
  return REQUIRED.filter(({ key }) => {
    if (key === "developer") return !hasDeveloper;
    const v = a[key];
    return v == null || (Array.isArray(v) && v.length === 0);
  }).map((r) => r.label);
}

async function findOrCreateCompany(name: string | null, kind: string) {
  const n = name?.trim();
  if (!n) return null;
  return (await prisma.ilCompany.findFirst({ where: { name: { equals: n, mode: "insensitive" } } })) ?? prisma.ilCompany.create({ data: { name: n, kind } });
}

async function findOrCreateAgent(agent: Extracted["agent"], sender: { name?: string; email: string } | null, companyId: string | null) {
  const email = (agent?.email ?? sender?.email ?? "").toLowerCase() || null;
  if (email && INTERNAL.test(email)) return null;
  const fullName = (agent?.name ?? sender?.name ?? "").trim();
  if (!email && !fullName) return null;
  const existing = email ? await prisma.ilContact.findFirst({ where: { email } }) : null;
  if (existing) return existing;
  const [firstName, ...rest] = fullName.split(/\s+/);
  return prisma.ilContact.create({ data: { firstName: firstName || null, lastName: rest.join(" ") || null, email, phone: agent?.phone ?? null, roles: '["Sales agent"]', companyId } });
}

function replyHtml(rows: { id: string; name: string; line: string; price: string; missing: string[] }[], base: string, note: string | null): string {
  const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const blocks = rows
    .map(
      (r) => `<p style="margin:10pt 0 4pt 0;"><b><a href="${base}/israel/apartments/${r.id}">${r.name}</a></b>${r.line ? ` <span style="color:#6b716e;">${r.line}</span>` : ""}${r.price ? ` <span style="color:#6b716e;">${r.price}</span>` : ""}</p>
${r.missing.length ? `<div style="margin:0 0 4pt 0;">Still missing:</div><ol style="margin:0 0 6pt 18pt;">${r.missing.map((m) => `<li>${m}</li>`).join("")}</ol>` : `<div style="margin:0 0 6pt 0;">Nothing missing. The ticket is complete.</div>`}`,
    )
    .join("");
  return `<div style="${font}">
<p>${rows.length === 1 ? "Apartment ticket created" : `${rows.length} apartment tickets created`} in RJL Israel.</p>
${blocks}
${note ? `<p style="color:#6b716e;">${note}</p>` : ""}
<p style="color:#6b716e;font-size:9pt;">Reply to the agent for the missing items and forward their answer here; edit anything on the ticket in the CRM. A floorplan attached to the email is saved on the ticket.</p>
</div>`;
}

async function replyOnThread(msg: Msg, html: string) {
  const draft = await graph<{ id: string }>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(msg.id)}/createReply`, { method: "POST", body: JSON.stringify({}) });
  const to = msg.from?.emailAddress.address ? [{ emailAddress: { address: msg.from.emailAddress.address } }] : [];
  await graph(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(draft.id)}`, { method: "PATCH", body: JSON.stringify({ body: { contentType: "html", content: html }, toRecipients: to }) });
  await graph(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(draft.id)}/send`, { method: "POST" });
}

/** A floorplan attached to the email (image or PDF with "plan" in its name, else the first image) goes onto the ticket. */
async function attachFloorplan(messageId: string, apartmentId: string) {
  const r = await graph<{ value: Att[] }>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}/attachments?$select=id,name,contentType,size,isInline`).catch(() => ({ value: [] as Att[] }));
  const files = r.value.filter((a) => !a.isInline && a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.size < 20 * 1024 * 1024);
  const plan = files.find((a) => /plan|tochnit|תכנית/i.test(a.name) && (a.contentType?.startsWith("image/") || a.contentType === "application/pdf")) ?? files.find((a) => a.contentType?.startsWith("image/") && a.size > 40_000);
  if (!plan) return;
  const bytes = Buffer.from(await graph<ArrayBuffer>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}/attachments/${q(plan.id)}/$value`, { raw: true }));
  await prisma.ilApartment.update({ where: { id: apartmentId }, data: { floorplan: bytes, floorplanType: plan.contentType ?? "application/octet-stream", floorplanName: plan.name } });
}

export async function processIsraelMessage(messageId: string): Promise<{ apartments: number } | { skipped: string }> {
  const msg = await graph<Msg>(`/users/${q(ISRAEL_MAILBOX())}/messages/${q(messageId)}?$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,from,body`);
  const key = msg.internetMessageId ?? msg.id;
  if (await prisma.ilInbound.findUnique({ where: { messageId: key } })) return { skipped: "already processed" };
  const from = msg.from?.emailAddress.address?.toLowerCase() ?? "";
  if (from === ISRAEL_MAILBOX().toLowerCase()) return { skipped: "own reply" };
  const mark = (result: string) => prisma.ilInbound.create({ data: { messageId: key, mailbox: ISRAEL_MAILBOX(), subject: msg.subject, fromEmail: from || null, result } });
  if (/^(automatic reply|out of office|undeliverable)/i.test(msg.subject ?? "")) {
    await mark("skipped: auto-reply");
    return { skipped: "auto-reply" };
  }
  const bodyText = msg.body?.contentType?.toLowerCase() === "html" ? emailHtmlToText(msg.body.content) : (msg.body?.content ?? "");
  const atts = msg.hasAttachments ? await readAttachments(msg.id) : { names: [], texts: [] };
  const extracted = await extract(msg.subject, bodyText, atts.texts);
  if (!extracted.apartments.length) {
    await mark("skipped: no apartment found");
    await replyOnThread(msg, `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;"><p>I could not find an apartment in this email or its attachments, so no ticket was created. Forward the listing with the details (address, size, price) or add it by hand under Apartments in RJL Israel.</p></div>`).catch(() => null);
    return { skipped: "no apartments" };
  }
  const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
  const senderIsInternal = !from || INTERNAL.test(from);
  const sender = senderIsInternal ? null : { name: msg.from?.emailAddress.name, email: from };
  const agentCompany = await findOrCreateCompany(extracted.agent?.company ?? null, "Agency");
  const agent = await findOrCreateAgent(extracted.agent, sender, agentCompany?.id ?? null);
  const rows: { id: string; name: string; line: string; price: string; missing: string[] }[] = [];
  for (const a of extracted.apartments) {
    const developer = await findOrCreateCompany(a.developerName, "Developer");
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
        mirpesetSqm: a.mirpesetSqm,
        ceilingCm: a.ceilingCm,
        machsanSqm: a.machsanSqm,
        machsanLocation: a.machsanLocation && (IL_MACHSAN_LOCATIONS as readonly string[]).includes(a.machsanLocation) ? a.machsanLocation : null,
        parkingSpots: a.parkingSpots && (IL_PARKING as readonly string[]).includes(a.parkingSpots) ? a.parkingSpots : null,
        direction: JSON.stringify(a.direction),
        mirpesetDirection: JSON.stringify(a.mirpesetDirection),
        mamad: a.mamad ?? false,
        priceNis: a.priceNis,
        sellerType: a.sellerType,
        renovationYear: a.sellerType?.startsWith("Second hand") ? a.renovationYear : null,
        description: a.description ? stripDashes(a.description) : null,
        source: `Email from ${msg.from?.emailAddress.name ?? from}`,
        sourceMessageId: key,
      },
    });
    await prisma.ilNote.create({ data: { apartmentId: created.id, body: `Created from an email to ${ISRAEL_MAILBOX()}${msg.subject ? `: "${msg.subject}"` : ""}${atts.names.length ? ` with ${atts.names.join(", ")}` : ""}` } });
    if (extracted.apartments.length === 1) await attachFloorplan(msg.id, created.id).catch(() => null);
    rows.push({ id: created.id, name: created.name, line: [a.rooms ? `${a.rooms} rooms` : null, a.internalSqm ? sqm(a.internalSqm) : null, [a.neighborhood, a.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · "), price: a.priceNis ? `${nis(a.priceNis)}${pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm) ? ` (${nis(pricePerMeter(a.priceNis, a.internalSqm, a.mirpesetSqm))} per m²)` : ""}` : "", missing: missingFor(a, Boolean(developer)) });
  }
  await mark(`created ${rows.length}`);
  const note = agent ? `Agent on file: ${[agent.firstName, agent.lastName].filter(Boolean).join(" ") || agent.email}.` : null;
  await replyOnThread(msg, replyHtml(rows, base, note)).catch((e) => console.error("israel intake reply failed", e));
  return { apartments: rows.length };
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
  const subs = await graph<{ value: { id: string; resource: string; notificationUrl: string }[] }>("/subscriptions");
  const mine = subs.value.find((s) => s.resource.toLowerCase() === resource.toLowerCase() && s.notificationUrl === notificationUrl);
  const expiration = new Date(Date.now() + 4000 * 60_000).toISOString();
  if (mine) {
    await graph(`/subscriptions/${mine.id}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime: expiration }) });
    return `renewed ${mine.id}`;
  }
  const created = await graph<{ id: string }>("/subscriptions", { method: "POST", body: JSON.stringify({ changeType: "created", notificationUrl, resource, expirationDateTime: expiration, clientState: process.env.CRON_SECRET }) });
  return `created ${created.id}`;
}
