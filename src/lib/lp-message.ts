import { prisma } from "@/lib/db";
import { graph, graphConfigured } from "@/lib/graph";

/** An email we logged, found again in whichever team mailbox holds a copy (mine first), with its body. */
export type MessageCopy = { box: string; id: string; body: string; hasAttachments: boolean; receivedDateTime?: string; from?: { emailAddress?: { name?: string; address?: string } } };

export async function findMessageCopy(internetMessageId: string, preferMailbox: string): Promise<MessageCopy | null> {
  if (!graphConfigured()) return null;
  const users = await prisma.user.findMany({ where: { active: true }, select: { email: true, israelEmail: true } });
  // the mailbox the email was logged from first, then the RJL Capital Advisors mailboxes, then the RJL Israel ones
  const boxes = [preferMailbox, ...users.map((u) => u.email).filter((e): e is string => Boolean(e)), process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com", ...users.map((u) => u.israelEmail).filter((e): e is string => Boolean(e)), process.env.ISRAEL_DEALS_MAILBOX ?? "deals@rjlisrael.com"].filter((b, i, arr) => b && arr.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i);
  for (const box of boxes) {
    try {
      const r = await graph<{ value: { id: string; body?: { content: string }; hasAttachments?: boolean; receivedDateTime?: string; from?: MessageCopy["from"] }[] }>(`/users/${encodeURIComponent(box)}/messages?$filter=${encodeURIComponent(`internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`)}&$select=id,body,hasAttachments,receivedDateTime,from`);
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
  const cut = text.split(/\n\s*(?:From:|-----Original Message-----|On .{5,80} wrote:|Sent from my|Get Outlook for)/i)[0];
  // drop a trailing signature: from the sign-off line on ("Thanks," "Best regards, Jim")
  const lines = cut.split("\n").map((l) => l.trim());
  const SIGN_OFF = /^(thanks|thank you|thanks so much|thanks again|many thanks|thx|best|best regards|kind regards|warm regards|warmest|regards|cheers|sincerely|talk soon|take care|all the best|appreciate it)[\s,!.]*(?:[A-Z][a-z]+\.?){0,2}$/i;
  const signOff = lines.findIndex((l, i) => i > 0 && SIGN_OFF.test(l));
  const kept = signOff > 0 ? lines.slice(0, signOff) : lines;
  // then whatever signature lines are left at the bottom: phone, email, links, titles, firm names, a bare name
  const SIG_LINE = /(\d{3}[).\-\s]\s?\d{3}[.\-\s]\d{4}|@\w|https?:\/\/|www\.|\b(ceo|cfo|coo|cio|president|vice president|vp|managing director|managing partner|director|principal|partner|founder|associate|analyst|manager|head of|chief|executive|officer|senior|sr\.|jr\.)\b|\b(llc|inc\.?|l\.?p\.?|ltd\.?|capital|partners|group|advisors|investments|equity|management|holdings|realty|properties)\s*$|^[|•·]|\b(o|m|c|t|p|f|e|mobile|cell|office|phone|tel|fax|email)\s*[:.]\s)/i;
  const NAME_LINE = /^(?:[A-Z][\w'’.-]+\s?){1,4}$/;
  let end = kept.length;
  while (end > 1 && kept[end - 1] === "") end--;
  let stripped = false;
  while (end > 1) {
    const l = kept[end - 1];
    if (l === "" || SIG_LINE.test(l) || (NAME_LINE.test(l) && l.split(/\s+/).length <= 4)) {
      end--;
      stripped = stripped || l !== "";
      continue;
    }
    break;
  }
  void stripped;
  return kept.slice(0, end).join("\n").trim().slice(0, 4000);
}
