import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";

/** An email we logged, found again in whichever team mailbox holds a copy (mine first), with its body. */
export type MessageCopy = { box: string; id: string; body: string; hasAttachments: boolean; receivedDateTime?: string; from?: { emailAddress?: { name?: string; address?: string } } };

export async function findMessageCopy(internetMessageId: string, preferMailbox: string): Promise<MessageCopy | null> {
  if (!graphConfigured()) return null;
  const users = await prisma.user.findMany({ where: { active: true, email: { not: null } }, select: { email: true } });
  const boxes = [preferMailbox, ...users.map((u) => u.email!), process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com"].filter((b, i, arr) => arr.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i);
  for (const box of boxes) {
    try {
      const r = await graph<{ value: { id: string; body?: { content: string }; hasAttachments?: boolean; receivedDateTime?: string; from?: MessageCopy["from"] }[] }>(`/users/${encodeURIComponent(box)}/messages?$filter=internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'&$select=id,body,hasAttachments,receivedDateTime,from`);
      const m = r.value?.[0];
      if (m) return { box, id: m.id, body: m.body?.content ?? "", hasAttachments: Boolean(m.hasAttachments), receivedDateTime: m.receivedDateTime, from: m.from };
    } catch {
      /* next mailbox */
    }
  }
  return null;
}

/** What the LP wrote, without the signature block and the quoted thread underneath. */
export function lpOwnWords(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  const cut = text.split(/\n\s*(?:From:|-----Original Message-----|On .{5,80} wrote:|Sent from my)/i)[0];
  // drop a trailing signature: from the sign-off line on
  const lines = cut.split("\n");
  const signOff = lines.findIndex((l, i) => i > 0 && /^(thanks|thank you|best|regards|cheers|sincerely|talk soon)[\s,!.]*$/i.test(l.trim()));
  return (signOff > 0 ? lines.slice(0, signOff) : lines).join("\n").trim().slice(0, 4000);
}
