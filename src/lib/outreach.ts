import { prisma } from "@/lib/db";
import { graph, graphConfigured, listAttachments } from "@/lib/graph";
import { bestContactForCompany } from "@/lib/engagement";
import type { DealFile } from "@/lib/send-deal";

/**
 * Reach out (Jonathan, Oct 28, 2026): from Investor search, tick up to thirty LPs and send them the firm's brochure through the
 * very same machinery as a deal: a record that the Send deal page, the launch queue (one email at a time, paced by the
 * attachment), bounces, departures and Follow ups all work on. The record is a Deal in the stage "Outreach", which no board,
 * report, reader or sweep lists (every one of those picks stages by name), so it never passes for a deal.
 */
export const OUTREACH_STAGE = "Outreach";
export const MAX_OUTREACH = 30;
export const isOutreach = (d: { stage?: string | null } | null | undefined) => d?.stage === OUTREACH_STAGE;
/** Who a reach out goes to: LPs (Investor search) or sponsors (Sponsor search, Jonathan, Oct 28, 2026). Kept in the record's details. */
export type Audience = "investor" | "sponsor";
export const outreachAudience = (details: string | null | undefined): Audience => {
  try {
    return (JSON.parse(details || "{}") as { audience?: string }).audience === "sponsor" ? "sponsor" : "investor";
  } catch {
    return "investor";
  }
};
/** The pages of a reach out live under the search it came from: /investors/reach/<id> or /sponsors/reach/<id>. */
export const reachBase = (audience: Audience) => (audience === "sponsor" ? "/sponsors" : "/investors");
const NAME_PREFIX = (audience: Audience) => (audience === "sponsor" ? "Sponsor reach out · " : "Reach out · ");

const DEALS_MAILBOX = () => process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com";

/** One reach out: a record with the ticked firms as Deal Not Sent rows, ready for the Send page. */
export async function createOutreach(companyIds: string[], audience: Audience = "investor"): Promise<{ id: string; firms: number }> {
  const ids = [...new Set(companyIds)].slice(0, MAX_OUTREACH);
  const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const sameDay = await prisma.deal.count({ where: { stage: OUTREACH_STAGE, name: { startsWith: `${NAME_PREFIX(audience)}${day}` } } });
  const name = `${NAME_PREFIX(audience)}${day}${sameDay ? ` (${sameDay + 1})` : ""}`;
  const deal = await prisma.deal.create({ data: { name, stage: OUTREACH_STAGE, details: JSON.stringify({ outreach: true, audience }) } });
  let firms = 0;
  for (const cid of ids) {
    const c = await bestContactForCompany(cid);
    if (!c) continue;
    await prisma.dealInvestor.create({ data: { dealId: deal.id, contactId: c.id, status: 1 } }).catch(() => null);
    firms++;
  }
  return { id: deal.id, firms };
}

/** The latest reach outs, for the Investor search rail: a launch still going is a click away. */
export async function recentOutreaches(audience: Audience = "investor", take = 5): Promise<{ id: string; name: string; firms: number; sent: number; createdAt: Date }[]> {
  const rows = await prisma.deal.findMany({ where: { stage: OUTREACH_STAGE, details: audience === "sponsor" ? { contains: '"audience":"sponsor"' } : { not: { contains: '"audience":"sponsor"' } } }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, createdAt: true, investors: { select: { status: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, firms: r.investors.length, sent: r.investors.filter((i) => i.status >= 2).length, createdAt: r.createdAt }));
}

// ---------- the brochure: one file, kept as an attachment on a draft in deals@, attached to every reach-out email ----------

export const BROCHURE_KEY = "brochure";
const BROCHURE_SETTING = "outreachBrochure";
const UPLOAD_SETTING = "outreachBrochureUpload";
/** Graph upload sessions take ranges in multiples of 320 KiB; ten of them stay under the 4.5 MB a Vercel request may carry. */
export const BROCHURE_PART_BYTES = 327_680 * 10;
export const BROCHURE_MAX_BYTES = 25 * 1024 * 1024;

export type Brochure = { mailbox: string; graphId: string; attachmentId: string; name: string; size: number; contentType: string; uploadedAt: string; by: string | null };
type Upload = { uploadUrl: string; mailbox: string; graphId: string; name: string; size: number; contentType: string; parts: number; received: number };

const readJson = async <T,>(key: string): Promise<T | null> => {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  if (!s?.value) return null;
  try {
    return JSON.parse(s.value) as T;
  } catch {
    return null;
  }
};
const writeJson = (key: string, v: unknown) => prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });

export const brochureInfo = () => readJson<Brochure>(BROCHURE_SETTING);

/** The brochure as a file on a reach-out record: the Send page lists it, ticks it, and the launch reads its bytes from deals@ like any attachment. */
export async function brochureFile(): Promise<DealFile | null> {
  const b = await brochureInfo();
  if (!b) return null;
  return { key: BROCHURE_KEY, mailbox: b.mailbox, messageId: b.graphId, attachmentId: b.attachmentId, name: b.name, size: b.size, contentType: b.contentType, from: b.by ?? "RJL CRM", receivedAt: b.uploadedAt };
}

export async function brochureBytes(): Promise<{ bytes: Uint8Array; name: string; contentType: string } | null> {
  const b = await brochureInfo();
  if (!b || !graphConfigured()) return null;
  const q = encodeURIComponent;
  const bytes = new Uint8Array(await graph<ArrayBuffer>(`/users/${q(b.mailbox)}/messages/${q(b.graphId)}/attachments/${q(b.attachmentId)}/$value`, { raw: true }));
  return { bytes, name: b.name, contentType: b.contentType };
}

/**
 * One part of the brochure, in order (part 0 first). Part 0 opens a draft in deals@ and an upload session on it; every part is put
 * to that session; the last one records the attachment and drops the brochure it replaces. Returns what the page shows.
 */
export async function receiveBrochurePart(opts: { part: number; parts: number; name: string; size: number; contentType: string; bytes: Uint8Array; by: string | null }): Promise<{ done: boolean; received: number; brochure?: Brochure }> {
  if (!graphConfigured()) throw new Error("Microsoft 365 is not connected");
  const name = opts.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "brochure.pdf";
  if (opts.size <= 0 || opts.size > BROCHURE_MAX_BYTES) throw new Error("the brochure must be under 25 MB");
  const q = encodeURIComponent;
  const mailbox = DEALS_MAILBOX();
  let up = await readJson<Upload>(UPLOAD_SETTING);
  if (opts.part === 0) {
    if (up?.graphId) await graph(`/users/${q(mailbox)}/messages/${q(up.graphId)}`, { method: "DELETE" }).catch(() => null); // an upload left half done
    const draft = await graph<{ id: string }>(`/users/${q(mailbox)}/messages`, { method: "POST", body: JSON.stringify({ subject: `RJL CRM: reach-out brochure (${name}), do not delete`, body: { contentType: "text", content: "The brochure attached to every reach-out email the CRM sends. Replace it from the Send page of a reach out." } }) });
    const session = await graph<{ uploadUrl: string }>(`/users/${q(mailbox)}/messages/${q(draft.id)}/attachments/createUploadSession`, { method: "POST", body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name, size: opts.size } }) });
    up = { uploadUrl: session.uploadUrl, mailbox, graphId: draft.id, name, size: opts.size, contentType: opts.contentType || "application/pdf", parts: opts.parts, received: 0 };
    await writeJson(UPLOAD_SETTING, up);
  }
  if (!up || up.received !== opts.part) throw new Error(`upload out of order (expected part ${up?.received ?? 0}, got ${opts.part}); start again`);
  const start = opts.part * BROCHURE_PART_BYTES;
  const end = start + opts.bytes.byteLength;
  if (end > up.size) throw new Error("more bytes than the file has");
  const res = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Length": String(opts.bytes.byteLength), "Content-Range": `bytes ${start}-${end - 1}/${up.size}`, "Content-Type": "application/octet-stream" }, body: Buffer.from(opts.bytes) });
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  up.received = opts.part + 1;
  const done = end >= up.size;
  if (!done) {
    await writeJson(UPLOAD_SETTING, up);
    return { done: false, received: up.received };
  }
  // the attachment is on the draft now; its id comes from the list (the final PUT answers with a Location header only)
  const atts = await listAttachments(mailbox, up.graphId);
  const att = atts.filter((a) => a.name === name).sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0] ?? atts[0];
  if (!att) throw new Error("the upload finished but the attachment is not on the draft");
  const old = await brochureInfo();
  const brochure: Brochure = { mailbox, graphId: up.graphId, attachmentId: att.id, name, size: up.size, contentType: att.contentType ?? up.contentType, uploadedAt: new Date().toISOString(), by: opts.by };
  await writeJson(BROCHURE_SETTING, brochure);
  await prisma.setting.delete({ where: { key: UPLOAD_SETTING } }).catch(() => null);
  if (old && old.graphId !== up.graphId) await graph(`/users/${q(old.mailbox)}/messages/${q(old.graphId)}`, { method: "DELETE" }).catch(() => null);
  return { done: true, received: up.received, brochure };
}

// ---------- the email ----------

export const OUTREACH_TEMPLATE_KIND = "OUTREACH";
export const OUTREACH_SPONSOR_TEMPLATE_KIND = "OUTREACH_SPONSOR";
export const outreachTemplateKind = (audience: Audience) => (audience === "sponsor" ? OUTREACH_SPONSOR_TEMPLATE_KIND : OUTREACH_TEMPLATE_KIND);

const SEED: Record<Audience, { name: string; subject: string; body: string[] }> = {
  investor: {
    name: "Reach out (brochure)",
    subject: "Introduction: RJL Capital Advisors",
    body: [
      "<div><p>Hi {{contact.firstName|there}} - {{openingLine|hope you are well.}}</p>",
      "<p>I wanted to introduce RJL Capital Advisors. We are a boutique capital placement firm arranging JV equity, preferred equity, co-GP equity and senior and mezzanine debt for real estate sponsors across the country.</p>",
      "<p>Attached is a short overview of placements we have completed. If the opportunities we see fit what you are looking for, I would welcome a quick call to go over your criteria, so that what we send you matches.</p>",
      "<p>Looking forward to connecting.</p></div>",
    ],
  },
  sponsor: {
    name: "Reach out to sponsors (brochure)",
    subject: "RJL Capital Advisors intro",
    body: [
      "<div><p>Hi {{contact.firstName|there}} - {{openingLine|hope you are well.}}</p>",
      "<p>I run RJL Capital Advisors. We place equity and debt for real estate sponsors, mostly $10MM to $100MM, with capital groups we work with every week. Attached is a short brochure of deals we have closed.</p>",
      "<p>If you have an acquisition or development coming up that needs equity, pref or a loan, send it over and I will tell you quickly whether we can place it and at what terms.</p>",
      "<p>Happy to jump on a quick call if easier.</p></div>",
    ],
  },
};

/** The reach-out email template for an audience, created once in the house style; Jonathan edits it under Templates like any other. */
export async function ensureOutreachTemplate(audience: Audience = "investor"): Promise<{ id: string; name: string }[]> {
  const kind = outreachTemplateKind(audience);
  const have = await prisma.emailTemplate.findMany({ where: { kind, workspace: "CA", NOT: { name: { startsWith: "(archived)" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (have.length) return have;
  const seed = SEED[audience];
  const t = await prisma.emailTemplate.create({ data: { name: seed.name, kind, workspace: "CA", subject: seed.subject, bodyHtml: seed.body.join("") }, select: { id: true, name: true } });
  return [t];
}
