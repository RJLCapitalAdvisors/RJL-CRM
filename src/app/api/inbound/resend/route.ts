import { createHmac, timingSafeEqual } from "node:crypto";
import { processIntake } from "@/app/intake/actions";
import { mailConfigured, sendEmail } from "@/lib/mailer";
import { type ExtractedDeal } from "@/lib/intake";
import { labelFor } from "@/lib/checklist";

/**
 * Resend Inbound webhook. Configure in Resend: Webhooks -> Add Webhook ->
 * URL https://<app>/api/inbound/resend, event `email.received`. Put the signing secret
 * (starts with whsec_) in RESEND_WEBHOOK_SECRET.
 *
 * The event carries metadata only; the body is fetched from GET /emails/receiving/{id}.
 */

function verifySvix(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  // Reject if timestamp is more than 5 minutes off.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  attachments?: { filename?: string; content_type?: string; size?: number }[];
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!secret || !apiKey) return new Response("Inbound not configured", { status: 503 });

  const raw = await req.text();
  if (!verifySvix(raw, req.headers, secret)) return new Response("Bad signature", { status: 401 });

  const event = JSON.parse(raw) as { type: string; data: { email_id: string; from: string; to: string[]; subject: string; attachments?: { filename?: string }[] } };
  // delivery events on blasts: opened / bounced / complained, matched by the provider id we stored when sending
  if (event.type !== "email.received") {
    const { prisma } = await import("@/lib/db");
    const rid = event.data?.email_id;
    const rec = rid ? await prisma.campaignRecipient.findFirst({ where: { providerId: rid }, select: { id: true, contactId: true, status: true } }) : null;
    if (rec) {
      if (event.type === "email.opened" && ["SENT"].includes(rec.status)) await prisma.campaignRecipient.update({ where: { id: rec.id }, data: { status: "OPENED", openedAt: new Date() } });
      else if (event.type === "email.clicked" && ["SENT", "OPENED"].includes(rec.status)) await prisma.campaignRecipient.update({ where: { id: rec.id }, data: { status: "CLICKED", openedAt: new Date() } });
      else if (event.type === "email.bounced") {
        await prisma.campaignRecipient.update({ where: { id: rec.id }, data: { status: "BOUNCED", nextFollowUpAt: null, error: "bounced" } });
        await prisma.contact.update({ where: { id: rec.contactId }, data: { bounceReason: "hard bounce (Resend)" } }).catch(() => null);
      } else if (event.type === "email.complained") {
        await prisma.campaignRecipient.update({ where: { id: rec.id }, data: { status: "UNSUBSCRIBED", nextFollowUpAt: null } });
        await prisma.contact.update({ where: { id: rec.contactId }, data: { unsubscribed: true } }).catch(() => null);
      }
    }
    return Response.json({ ok: true, handled: event.type, matched: Boolean(rec) });
  }

  const res = await fetch(`https://api.resend.com/emails/receiving/${event.data.email_id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return new Response(`Could not fetch email: ${res.status}`, { status: 502 });
  const email = (await res.json()) as ReceivedEmail;

  const m = email.from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const fromName = m ? m[1].trim() || null : null;
  const fromEmail = (m ? m[2] : email.from).trim().toLowerCase();
  const text = email.text?.trim() || (email.html ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return Response.json({ ok: true, skipped: "empty body" });
  const attachments = (email.attachments ?? []).map((a) => a.filename ?? "attachment");

  const intake = await processIntake({ rawText: text, subject: email.subject || null, fromName, fromEmail, toEmail: email.to?.[0] ?? null, source: "WEBHOOK", attachments });

  if (mailConfigured()) {
    const d = JSON.parse(intake.extracted) as ExtractedDeal;
    const missing = JSON.parse(intake.missing) as string[];
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const rows = Object.entries(d)
      .filter(([k, v]) => v != null && v !== "" && !["confidenceNotes", "contactName", "contactEmail", "details"].includes(k))
      .map(([k, v]) => `<tr><td style="padding:2px 8px;color:#6b716e">${k}</td><td style="padding:2px 8px">${String(v)}</td></tr>`)
      .join("");
    try {
      await sendEmail({
        to: fromEmail,
        subject: `Deal intake: ${d.propertyName ?? email.subject ?? "forwarded deal"} – ${missing.length ? `${missing.length} items missing` : "checklist complete"}`,
        html: `<p>Logged the deal you forwarded in the CRM (Deal Received). <a href="${base}/deals/${intake.dealId}">Open the deal</a>.</p>
<h3>Extracted</h3><table>${rows}</table>
<h3>Still needed from the sponsor</h3>${missing.length ? `<ol>${missing.map((k) => `<li>${labelFor(k, d.strategy)}</li>`).join("")}</ol>` : "<p>Nothing – checklist complete.</p>"}
${d.confidenceNotes ? `<p style="color:#6b716e">${d.confidenceNotes}</p>` : ""}`,
      });
    } catch {
      // best effort
    }
  }
  return Response.json({ ok: true, id: intake.id });
}
