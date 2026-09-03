import { prisma } from "@/lib/db";
import { verifyContactToken } from "@/lib/tokens";

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Helvetica,Arial,sans-serif;background:#fffcf0;color:#1a2321;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:420px;padding:32px;background:#fff;border:1px solid #e6e2d3;border-radius:12px;text-align:center">
<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#6b716e">${body}</p>
<p style="margin:24px 0 0;font-size:12px;color:#6b716e">RJL Capital Advisors</p></div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyContactToken(token);
  if (!id) return page("Link not valid", "This unsubscribe link is not valid.");
  const contact = await prisma.contact.findUnique({ where: { id }, select: { id: true, unsubscribed: true } });
  if (!contact) return page("Link not valid", "We could not find this subscription.");
  if (!contact.unsubscribed) {
    await prisma.contact.update({ where: { id }, data: { unsubscribed: true } });
    await prisma.campaignRecipient.updateMany({ where: { contactId: id, status: "PENDING" }, data: { status: "UNSUBSCRIBED" } });
    await prisma.activity.create({ data: { type: "NOTE", body: "Unsubscribed from email via link", contactId: id } });
  }
  return page("You're unsubscribed", "You will no longer receive deal emails from us.");
}

// One-click unsubscribe (RFC 8058) posts to the same URL.
export const POST = GET;
