import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { appBase, describeFile, intakeApartments, NO_APARTMENT_TEXT, replyText, type IntakeFile } from "@/lib/israel-intake";
import { downloadMedia, markRead, prettyPhone, sendText, whatsappConfigured, type WaMessage, type WaWebhook } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The RJL Israel WhatsApp number, the way deals@ works for email. Meta calls GET once to verify the webhook, then
 * POSTs every incoming message. A listing often arrives as several messages in a row (text, then photos, then a
 * PDF), so we wait a short while and handle everything the same person sent in that window as one listing.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

const GATHER_MS = 45_000; // photos and files trickle in after the text

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return new Response("Bad signature", { status: 401 });
  }
  const body = JSON.parse(raw) as WaWebhook;
  const incoming: { msg: WaMessage; name: string | null; number: string }[] = [];
  for (const e of body.entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value;
      if (!v?.messages?.length) continue;
      const names = new Map((v.contacts ?? []).map((k) => [k.wa_id, k.profile?.name ?? null]));
      for (const m of v.messages) incoming.push({ msg: m, name: names.get(m.from) ?? null, number: v.metadata?.display_phone_number ?? v.metadata?.phone_number_id ?? "whatsapp" });
    }
  }
  if (!incoming.length) return Response.json({ ok: true, handled: 0 });
  // remember every piece right away (Meta retries if we are slow), then gather and process after the response
  for (const { msg, name, number } of incoming) {
    await prisma.waInbound.upsert({ where: { messageId: msg.id }, create: { messageId: msg.id, waId: msg.from, senderName: name, number, type: msg.type, payload: JSON.stringify(msg), receivedAt: new Date(Number(msg.timestamp) * 1000 || Date.now()) }, update: {} }).catch(() => null);
    markRead(msg.id).catch(() => null);
  }
  after(async () => {
    await new Promise((r) => setTimeout(r, GATHER_MS));
    for (const waId of new Set(incoming.map((x) => x.msg.from))) await processSender(waId).catch((e) => console.error("whatsapp intake failed", e));
  });
  return Response.json({ ok: true, handled: incoming.length });
}

/** Everything one person sent that is not yet handled becomes one listing (or several apartments, if that is what it says). */
async function processSender(waId: string) {
  if (!whatsappConfigured()) return;
  const pending = await prisma.waInbound.findMany({ where: { waId, handledAt: null }, orderBy: { receivedAt: "asc" } });
  if (!pending.length) return;
  // still arriving? another pump will come with the next message
  const newest = pending[pending.length - 1].receivedAt.getTime();
  if (Date.now() - newest < GATHER_MS - 5_000) return;
  await prisma.waInbound.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { handledAt: new Date() } });
  const msgs = pending.map((p) => JSON.parse(p.payload) as WaMessage);
  const texts: string[] = [];
  const files: IntakeFile[] = [];
  for (const m of msgs) {
    if (m.text?.body) texts.push(m.text.body);
    const media = m.image ?? m.document ?? m.video ?? null;
    const caption = m.image?.caption ?? m.document?.caption ?? m.video?.caption;
    if (caption) texts.push(caption);
    if (media && !m.video) {
      const dl = await downloadMedia(media.id).catch(() => null);
      if (dl) {
        const name = m.document?.filename ?? `${m.type}-${m.id.slice(-6)}.${(dl.mime.split("/")[1] ?? "bin").replace("jpeg", "jpg")}`;
        files.push(await describeFile(name, dl.mime, dl.bytes));
      }
    }
  }
  const sender = pending[0];
  const phone = prettyPhone(waId);
  const key = `wa:${msgs[0].id}`;
  const r = await intakeApartments({ channel: "WHATSAPP", key, subject: null, body: texts.join("\n\n"), files, sender: { name: sender.senderName, phone }, sourceLabel: `WhatsApp from ${sender.senderName ?? phone}`, mailbox: sender.number });
  const reply = "skipped" in r ? (r.skipped === "no apartments" ? NO_APARTMENT_TEXT : null) : replyText(r.rows, appBase(), r.note);
  if (reply) await sendText(waId, reply);
  await prisma.waInbound.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { result: "skipped" in r ? r.skipped : `created ${r.rows.length}` } });
}
