import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { graph } from "@/lib/graph";
import { israelMailConfigured } from "@/lib/israel-mail";
import { IL_CITIES } from "@/lib/israel";
import { stripDashes } from "@/lib/style";

/**
 * Apartments and houses people mention to RJL Israel but never send as a listing. Every RJL Israel mailbox is
 * already read into IlActivity; this reads those threads, asks Claude which specific properties came up, and
 * files each one as an IlDeal at the "Mentioned" stage. They sit in a Deals mentioned window on the RJL Israel
 * dashboard and in the Mentioned column of the funnel, so nothing a broker floats in passing gets lost. Once the
 * listing itself arrives at deals@rjlisrael.com it becomes an apartment or house ticket, and the mention is
 * closed against it.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 30;
const q = (s: string) => encodeURIComponent(s);
export const IL_MENTIONED = "Mentioned";

const Out = z.object({
  properties: z.array(
    z.object({
      name: z.string().describe("Short name in English as the sender refers to it: street and number, project, or neighborhood plus type, e.g. 'Rehavia, Ramban 12' or 'Laguna Netanya'"),
      city: z.string().describe("City in its usual English spelling if stated, else empty"),
      neighborhood: z.string().describe("Neighborhood in English if stated, else empty"),
      kind: z.enum(["apartment", "house", ""]).describe("house for a private house on its own plot, apartment for anything in a building, empty when unclear"),
      priceNis: z.number().nullable().describe("Asking price in shekels if stated, else null"),
      whatWasSaid: z.string().describe("One plain English line: what they said about it and whether they said they would send details. No dashes as punctuation."),
      promised: z.boolean().describe("True if they said they would send the listing, details, photos or a price"),
    }),
  ),
});

const SYSTEM = `You read recent emails between RJL Israel (a firm that buys apartments and houses in Israel for its clients) and an outside contact, usually a broker, developer or seller. Most of it is in Hebrew; read it natively and answer in English.
List every SPECIFIC property the other side mentioned that RJL Israel might look at: "the apartment on Ramban", "a penthouse in the Laguna project", "a cottage in Efrat we are about to list". Skip: properties RJL Israel already has (they are discussing a ticket, a viewing, an offer), general market talk, properties RJL Israel is selling or showing to the contact, and anything with no property in it at all.
Vocabulary: דירה apartment, בית פרטי / וילה / קוטג' house, פנטהאוז penthouse, דירת גן garden apartment, פרויקט project, חדרים rooms, מ"ר square metres, מחיר price, מיליון million (4.2 מיליון is 4,200,000), ש"ח shekels, רחוב street, שכונה neighborhood. Cities in English: ירושלים Jerusalem, תל אביב Tel Aviv, רעננה Ra'anana, הרצליה Herzliya, נתניה Netanya, בית שמש Beit Shemesh, אפרת Efrat.
One entry per property, deduplicated. No dashes as punctuation in what you write.`;

const norm = (s: string | null) => (s ?? "").replace(/^\s*((re|fw|fwd|תגובה|השב|הועבר)\s*:\s*)+/i, "").trim().toLowerCase();
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9֐-׿ ]+/g, " ").split(/\s+/).filter((x) => x.length > 3));
/** "Laguna" against "Laguna, Netanya": enough shared words to be the same property. */
function sameProperty(a: string, b: string): boolean {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit > 0 && hit >= Math.min(A.size, B.size) * 0.5;
}

export async function detectIsraelMentions(): Promise<{ threads: number; created: string[] }> {
  if (!israelMailConfigured() || !process.env.ANTHROPIC_API_KEY) return { threads: 0, created: [] };
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  const acts = await prisma.ilActivity.findMany({
    where: { type: "EMAIL", occurredAt: { gte: since }, externalId: { not: null }, contactId: { not: null } },
    include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, companyId: true, company: { select: { id: true, name: true } } } } },
    orderBy: { occurredAt: "desc" },
    take: 400,
  });
  // one thread per contact and subject, newest first, at most five messages each
  const threads = new Map<string, typeof acts>();
  for (const a of acts) {
    const key = `${a.contactId}|${norm(a.subject)}`;
    const list = threads.get(key) ?? [];
    if (list.length < 5) list.push(a);
    threads.set(key, list);
  }
  const client = new Anthropic();
  const created: string[] = [];
  let scanned = 0;
  for (const [, msgs] of threads) {
    const newest = msgs[0];
    if (await prisma.mentionScan.findUnique({ where: { externalId: newest.externalId! } })) continue; // this thread state already read
    const who = newest.contact!;
    const whoName = [who.firstName, who.lastName].filter(Boolean).join(" ") || who.email || "the contact";
    // full bodies from the mailbox that holds them
    const parts: string[] = [];
    for (const m of [...msgs].reverse()) {
      const meta = m.meta ? (JSON.parse(m.meta) as { mailbox?: string; from?: { name?: string; address: string } }) : {};
      let body = m.body ?? "";
      if (meta.mailbox) {
        try {
          const r = await graph<{ value: { body: { content: string } }[] }>(`/users/${q(meta.mailbox)}/messages?$filter=${encodeURIComponent(`internetMessageId eq '${m.externalId!.replace(/'/g, "''")}'`)}&$select=body`);
          const html = r.value[0]?.body?.content;
          if (html) body = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
        } catch {
          /* keep the preview */
        }
      }
      parts.push(`[${m.occurredAt.toISOString().slice(0, 10)}] ${m.direction === "OUTBOUND" ? "RJL Israel" : whoName}: ${m.subject ?? ""}\n${body}`);
    }
    scanned++;
    let out: z.infer<typeof Out> | null = null;
    try {
      const content = `Contact: ${whoName}${who.company?.name ? ` (${who.company.name})` : ""}\n\n${parts.join("\n\n")}\n\nAnswer with one JSON object only, no prose and no code fence, matching this JSON schema exactly:\n${JSON.stringify(z.toJSONSchema(Out))}`;
      const res = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] });
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const parsed = Out.safeParse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
      out = parsed.success ? parsed.data : null;
    } catch {
      out = null;
    }
    await prisma.mentionScan.create({ data: { externalId: newest.externalId! } }).catch(() => {}); // the id space is RJL Israel's, so no companyId here
    if (!out) continue;

    // what RJL Israel already has: every apartment, house and mention on the books
    const [apts, houses, mentions] = await Promise.all([
      prisma.ilApartment.findMany({ select: { name: true, street: true, city: true } }),
      prisma.ilHouse.findMany({ select: { name: true, street: true, city: true } }),
      prisma.ilDeal.findMany({ where: { stage: { notIn: ["Closed", "Lost"] } }, select: { name: true } }),
    ]);
    const known = [...apts.map((a) => `${a.name} ${a.street ?? ""} ${a.city ?? ""}`), ...houses.map((h) => `${h.name} ${h.street ?? ""} ${h.city ?? ""}`), ...mentions.map((m) => m.name)];
    for (const pty of out.properties) {
      const name = stripDashes(pty.name).trim();
      if (!name) continue;
      if (known.some((k) => sameProperty(name, k))) continue;
      const city = IL_CITIES.find((c) => c.toLowerCase() === pty.city.trim().toLowerCase()) ?? pty.city.trim();
      const label = [name, [pty.neighborhood, city].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
      await prisma.ilDeal.create({
        data: {
          name: label,
          stage: IL_MENTIONED,
          agentContactId: who.id,
          offerNis: pty.priceNis ?? null,
          description: stripDashes(pty.whatWasSaid),
          expectedClose: pty.kind || null, // apartment | house, filled in when the listing arrives
          updatedAt: newest.occurredAt,
        },
      });
      created.push(label);
      known.push(label);
    }
  }
  return { threads: scanned, created };
}

/** A mention whose listing has since arrived (an apartment or house by that name) is closed against it. */
export async function closeLandedMentions(): Promise<number> {
  const mentions = await prisma.ilDeal.findMany({ where: { stage: IL_MENTIONED }, select: { id: true, name: true } });
  if (!mentions.length) return 0;
  const [apts, houses] = await Promise.all([
    prisma.ilApartment.findMany({ select: { id: true, name: true, street: true, city: true } }),
    prisma.ilHouse.findMany({ select: { id: true, name: true, street: true, city: true } }),
  ]);
  let n = 0;
  for (const m of mentions) {
    const apt = apts.find((a) => sameProperty(m.name, `${a.name} ${a.street ?? ""} ${a.city ?? ""}`));
    const house = !apt ? houses.find((h) => sameProperty(m.name, `${h.name} ${h.street ?? ""} ${h.city ?? ""}`)) : null;
    if (!apt && !house) continue;
    await prisma.ilDeal.update({ where: { id: m.id }, data: { stage: "Lead", apartmentId: apt?.id ?? null, description: apt || house ? `The listing arrived: ${(apt ?? house)!.name}` : undefined } });
    n++;
  }
  return n;
}
