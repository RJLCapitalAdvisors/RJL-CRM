// Outbound email via Resend's HTTP API. No SDK needed.
// Blasts go through a transactional provider rather than Outlook so bounces,
// unsubscribes, and sending reputation are handled properly.

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendEmail(msg: OutboundEmail): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = msg.from ?? process.env.MAIL_FROM;
  if (!key || !from) throw new Error("Email sending is not configured. Set RESEND_API_KEY and MAIL_FROM in .env.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      reply_to: msg.replyTo ?? process.env.MAIL_REPLY_TO ?? undefined,
      headers: msg.headers,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}
