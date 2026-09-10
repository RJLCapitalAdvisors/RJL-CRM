/**
 * WhatsApp Business (Meta Cloud API) for the RJL Israel deals number. Meta posts every message to
 * /api/inbound/whatsapp; we download the media, run the apartment intake, and answer on WhatsApp.
 * Env: WHATSAPP_TOKEN (permanent system-user token), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN (any
 * string you also paste into Meta's webhook form), WHATSAPP_APP_SECRET (to verify Meta's signature).
 */
const API = "https://graph.facebook.com/v21.0";
const token = () => process.env.WHATSAPP_TOKEN ?? "";
export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

export type WaMessage = {
  id: string;
  from: string; // wa_id, digits
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string; sha256?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  context?: { from?: string; id?: string; forwarded?: boolean };
};
export type WaWebhook = { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string; display_phone_number?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[] } }[] }[] };

/** Download a media item: first its URL, then the bytes (both need the bearer token). */
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const meta = await fetch(`${API}/${mediaId}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!meta.ok) return null;
  const j = (await meta.json()) as { url?: string; mime_type?: string };
  if (!j.url) return null;
  const r = await fetch(j.url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) return null;
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: j.mime_type ?? r.headers.get("content-type") ?? "application/octet-stream" };
}

/** A plain text reply to the person who wrote (allowed for 24 hours after their message). WhatsApp caps a text at 4096 characters. */
export async function sendText(to: string, body: string): Promise<boolean> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id || !token()) return false;
  const r = await fetch(`${API}/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4000), preview_url: true } }),
  });
  if (!r.ok) console.error("whatsapp send failed", r.status, await r.text().catch(() => ""));
  return r.ok;
}

/** Mark the message read so the sender sees the blue ticks while we work. */
export async function markRead(messageId: string) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id || !token()) return;
  await fetch(`${API}/${id}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }) }).catch(() => null);
}

/** +972 52 300 1122 from a wa_id like 972523001122. */
export const prettyPhone = (waId: string) => (/^972\d{8,9}$/.test(waId) ? `+972 ${waId.slice(3, 5)} ${waId.slice(5, 8)} ${waId.slice(8)}` : `+${waId}`);
