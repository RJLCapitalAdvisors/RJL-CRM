import { processIntake } from "@/app/intake/actions";
import { mailConfigured, sendEmail } from "@/lib/mailer";
import { type ExtractedDeal } from "@/lib/intake";
import { labelFor } from "@/lib/checklist";

/**
 * Inbound deal-email webhook.
 * Point your inbound email provider (Resend Inbound, Postmark Inbound, or a Power Automate
 * flow on an M365 shared mailbox) at POST /api/inbound with header `x-intake-secret`.
 * Accepts a generic JSON body: { from, fromName?, to, subject, text, html?, attachments?: [{filename}] }.
 */
export async function POST(req: Request) {
  const secret = process.env.INTAKE_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-intake-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return new Response("Bad JSON", { status: 400 });

  // Tolerate a few common provider shapes.
  const fromRaw = String(body.from ?? body.From ?? body.sender ?? "");
  const m = fromRaw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const fromName = String(body.fromName ?? body.FromName ?? (m ? m[1].trim() : "")) || null;
  const fromEmail = (m ? m[2] : fromRaw).trim().toLowerCase() || null;
  const to = String(body.to ?? body.To ?? "") || null;
  const subject = String(body.subject ?? body.Subject ?? "") || null;
  const text = String(body.text ?? body.TextBody ?? body["stripped-text"] ?? "");
  const html = String(body.html ?? body.HtmlBody ?? "");
  const rawText = text || html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+\n/g, "\n").trim();
  if (!rawText) return new Response("No body", { status: 400 });
  const attachments = Array.isArray(body.attachments) ? (body.attachments as Record<string, unknown>[]).map((a) => String(a.filename ?? a.Name ?? a.name ?? "attachment")) : [];

  const intake = await processIntake({ rawText, subject, fromName, fromEmail, toEmail: to, source: "WEBHOOK", attachments });

  // Reply to whoever forwarded it with the parse result and the missing-items list.
  if (mailConfigured() && fromEmail) {
    const d = JSON.parse(intake.extracted) as ExtractedDeal;
    const missing = JSON.parse(intake.missing) as string[];
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const rows = Object.entries(d)
      .filter(([k, v]) => v != null && !["confidenceNotes", "contactName", "contactEmail", "details"].includes(k))
      .map(([k, v]) => `<tr><td style="padding:2px 8px;color:#6b716e">${k}</td><td style="padding:2px 8px">${String(v)}</td></tr>`)
      .join("");
    try {
      await sendEmail({
        to: fromEmail,
        subject: `Deal intake: ${d.propertyName ?? subject ?? "forwarded deal"} – ${missing.length ? `${missing.length} items missing` : "complete"}`,
        html: `<p>Parsed the deal you forwarded. <a href="${base}/intake/${intake.id}">Review and create the deal</a>.</p>
<h3>Extracted</h3><table>${rows}</table>
<h3>Still needed from the sponsor</h3>${missing.length ? `<ul>${missing.map((k) => `<li>${labelFor(k, d.strategy)}</li>`).join("")}</ul>` : "<p>Nothing – checklist complete.</p>"}
${d.confidenceNotes ? `<p style="color:#6b716e">${d.confidenceNotes}</p>` : ""}`,
      });
    } catch {
      // Reply is best-effort; the intake record is already saved.
    }
  }
  return Response.json({ ok: true, id: intake.id });
}
