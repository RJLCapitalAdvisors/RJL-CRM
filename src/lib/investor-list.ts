import { prisma } from "@/lib/db";
import { createDraft, getMessage, graphConfigured, outlookDesktopLink } from "@/lib/graph";
import { signatureFor, type FollowUpResult } from "@/lib/followup";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The body of a Make list email: the firms one per line, then the sender's signature. No subject, no recipient: Jonathan fills those in. */
export function investorListHtml(names: string[], signature: string): string {
  const lines = [...names].sort((a, b) => a.localeCompare(b)).map((n) => `<div>${esc(n)}</div>`).join("");
  return `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt"><div>&nbsp;</div>${lines}<div>&nbsp;</div></div>${signature}`;
}

/** Investor search > Make list: a blank Outlook draft carrying the ticked firms (Jonathan, Oct 28, 2026). */
export async function createInvestorList(companyIds: string[], mailbox: string): Promise<FollowUpResult> {
  if (!graphConfigured()) return { ok: false, reason: "Microsoft 365 is not connected" };
  const groups = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { name: true } });
  if (!groups.length) return { ok: false, reason: "none of the ticked groups was found" };
  const html = investorListHtml(groups.map((g) => g.name), await signatureFor(mailbox));
  const draft = await createDraft(mailbox, { subject: "", toRecipients: [], bodyHtml: `<html><body>${html}</body></html>` });
  const fresh = await getMessage(mailbox, draft.id, "id,webLink,internetMessageId");
  return { ok: true, webLink: fresh.webLink ?? "", outlookLink: await outlookDesktopLink(mailbox, draft.id), messageId: fresh.internetMessageId ?? null, mode: "new", attachments: 0 };
}
