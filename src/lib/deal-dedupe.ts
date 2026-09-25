import { prisma } from "@/lib/db";
import { ACTIVE_STAGES, isBlindIntro } from "@/lib/taxonomy";

/**
 * One deal, one ticket. Three ways two tickets turn out to be the same deal, in order of certainty:
 *   1. the same property name (normalized),
 *   2. the same street address, or one ticket named after the other's address (an engagement letter subject line
 *      names "2700 South Green Street"; the ticket is "Westwind Apartments" at that address),
 *   3. the same sponsor in the same city, confirmed by Claude from what each ticket says.
 * findSameDeal runs at every creation point; possibleDuplicates lists survivors for Jonathan under Data updates.
 */

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|apartments|apartment|portfolio|deal|llc|plaza|center|centre)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "2700 South Green Street, Brownsburg" -> "2700 south green": number plus the first two street words. */
export const addressKey = (s: string | null | undefined): string | null => {
  const m = (s ?? "").toLowerCase().match(/\b(\d{2,6})\s+((?:[a-z]+\s+){0,2}[a-z]+)/);
  if (!m) return null;
  const words = m[2].split(/\s+/).filter((w) => !/^(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|pkwy|parkway|ln|lane|way|hwy|highway|n|s|e|w|north|south|east|west)$/.test(w)).slice(0, 2);
  return words.length ? `${m[1]} ${words.join(" ")}` : `${m[1]} ${m[2].split(/\s+/)[0]}`;
};
const normSponsor = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\b(the|llc|inc|group|capital|partners|properties|property|real estate|holdings|company|companies|co|ltd)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const cityOf = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export type DealCtx = { sponsorCompanyId?: string | null; sponsorName?: string | null; city?: string | null; state?: string | null; address?: string | null; text?: string | null };
type Cand = { id: string; name: string; propertyName: string | null; sponsorName: string | null; sponsorCompanyId: string | null; city: string | null; state: string | null; propertyAddress: string | null; summary: string | null };

const select = { id: true, name: true, propertyName: true, sponsorName: true, sponsorCompanyId: true, city: true, state: true, propertyAddress: true, summary: true, hubspotId: true } as const;

function certainMatch(name: string, ctx: DealCtx, d: Cand): boolean {
  const key = normName(name);
  const dKey = normName(d.propertyName ?? d.name);
  if (key.length >= 4 && key === dKey) return true;
  const a = addressKey(ctx.address) ?? addressKey(name);
  const b = addressKey(d.propertyAddress) ?? addressKey(d.propertyName ?? d.name);
  if (a && b && a === b) return true;
  // one ticket is named after the other's street address
  if (a && d.propertyAddress && addressKey(d.propertyAddress) === a) return true;
  return false;
}
/** Names that share more than half of their meaningful words, at least two: "BSPG Recap" and "Kansas City Metro Retail Portfolio (BSPG Recap)". */
/** One name is a whole-word part of the other ("Everett" in "Everett Mall Plaza"), 5+ letters, not a generic word. */
export function nameWithin(a: string, b: string): boolean {
  const x = normName(a), y = normName(b);
  if (x.length < 5 || y.length < 5 || x === y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (/^(plaza|center|centre|portfolio|apartments|apartment|village|park|place|square|commons|crossing|station|tower|towers|lofts|ranch|estates|the)$/.test(short)) return false;
  return new RegExp(`(^| )${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(long);
}
export function similarName(a: string, b: string): boolean {
  const w = (s: string) => new Set(normName(s).split(" ").filter((x) => x.length > 3));
  const A = w(a), B = w(b);
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit >= 2 && hit > Math.min(A.size, B.size) / 2;
}
function sameSponsorAndCity(ctx: DealCtx, d: Cand): boolean {
  const sponsor = (ctx.sponsorCompanyId && d.sponsorCompanyId === ctx.sponsorCompanyId) || (normSponsor(ctx.sponsorName) && normSponsor(ctx.sponsorName) === normSponsor(d.sponsorName));
  const city = cityOf(ctx.city) && cityOf(ctx.city) === cityOf(d.city);
  return Boolean(sponsor && city);
}

/**
 * The active deal this name (plus whatever else is known) is the same as, or null. Same name or same address
 * decides on its own; same sponsor and city asks Claude with the text at hand.
 */
export async function findSameDeal(name: string | null | undefined, excludeId?: string, ctx: DealCtx = {}): Promise<{ id: string; name: string } | null> {
  const n = (name ?? "").trim();
  if (n.length < 3 && !ctx.address) return null;
  const deals: Cand[] = await prisma.deal.findMany({ where: { stage: { in: [...ACTIVE_STAGES, "Deal Lost"] }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select }); // a lost deal that comes back is revived, not duplicated
  const certain = deals.find((d) => certainMatch(n, ctx, d));
  if (certain) return { id: certain.id, name: certain.name };
  const maybe = deals.filter((d) => sameSponsorAndCity(ctx, d));
  if (!maybe.length || !process.env.ANTHROPIC_API_KEY) return null;
  const { confirmSameDeal } = await import("@/lib/deal-knowledge");
  for (const d of maybe.slice(0, 3)) {
    const text = [`Deal: ${n}`, ctx.address ? `Address: ${ctx.address}` : "", ctx.text ?? ""].filter(Boolean).join("\n");
    if (await confirmSameDeal(d, n, null, text, { names: [], text: "" })) return { id: d.id, name: d.name };
  }
  return null;
}

/** Pairs of active tickets that look like one deal, for Jonathan to merge or wave off. */
export type DupePair = { a: DealCard; b: DealCard; why: string };
export type DealCard = { id: string; name: string; stage: string; sponsorName: string | null; city: string | null; state: string | null; propertyAddress: string | null; createdAt: Date; weight: number };

export async function possibleDuplicates(): Promise<DupePair[]> {
  // Deal Received or further on both sides: Deal Mentioned records are not tickets yet and only add noise here
  const deals = (await prisma.deal.findMany({ where: { stage: { in: ACTIVE_STAGES.filter((x) => x !== "Deal Mentioned") }, parentDealId: null }, select: { ...select, stage: true, createdAt: true, _count: { select: { investors: true, activities: true, files: true, facts: true, emails: true } } } })).filter((d) => !isBlindIntro({ ...d, fileCount: d._count.files, factCount: d._count.facts }));
  const cleared = new Set((await prisma.dealNotDuplicate.findMany()).map((x) => `${x.aId}|${x.bId}`));
  const card = (d: (typeof deals)[number]): DealCard => ({ id: d.id, name: d.propertyName ?? d.name, stage: d.stage, sponsorName: d.sponsorName, city: d.city, state: d.state, propertyAddress: d.propertyAddress, createdAt: d.createdAt, weight: d._count.investors * 5 + d._count.activities + d._count.files * 2 + d._count.facts + d._count.emails });
  const out: DupePair[] = [];
  for (let i = 0; i < deals.length; i++) {
    for (let j = i + 1; j < deals.length; j++) {
      const x = deals[i], y = deals[j];
      if (cleared.has(`${x.id}|${y.id}`) || cleared.has(`${y.id}|${x.id}`)) continue;
      const ctx: DealCtx = { sponsorCompanyId: x.sponsorCompanyId, sponsorName: x.sponsorName, city: x.city, state: x.state, address: x.propertyAddress };
      let why: string | null = null;
      if (normName(x.propertyName ?? x.name).length >= 4 && normName(x.propertyName ?? x.name) === normName(y.propertyName ?? y.name)) why = "same name";
      else if (certainMatch(x.propertyName ?? x.name, ctx, y)) why = "same address";
      else if (similarName(x.propertyName ?? x.name, y.propertyName ?? y.name)) why = "similar names";
      else if (nameWithin(x.propertyName ?? x.name, y.propertyName ?? y.name)) why = "one name contains the other";
      else if (sameSponsorAndCity(ctx, y)) why = `same sponsor, both in ${y.city}`;
      if (!why) continue;
      const [a, b] = card(x).weight >= card(y).weight ? [card(x), card(y)] : [card(y), card(x)];
      out.push({ a, b, why });
    }
  }
  return out.sort((p, q) => q.a.weight + q.b.weight - (p.a.weight + p.b.weight));
}

/**
 * Fold one ticket into another: every email, file, fact, activity, report row, action, campaign, launch and
 * momentum item moves over (report rows already on the target keep the higher status), blanks on the target fill
 * from the source, then the source is deleted. A note on the target says what happened.
 */
export async function mergeDeals(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  const [from, into] = await Promise.all([prisma.deal.findUniqueOrThrow({ where: { id: fromId } }), prisma.deal.findUniqueOrThrow({ where: { id: intoId } })]);
  await prisma.activity.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  await prisma.dealEmail.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  await prisma.dealFile.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  await prisma.dealFact.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  await prisma.dealAction.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  await prisma.campaign.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  await prisma.dealLaunch.updateMany({ where: { dealId: fromId }, data: { dealId: intoId } });
  const rows = await prisma.dealInvestor.findMany({ where: { dealId: fromId } });
  for (const r of rows) {
    const existing = await prisma.dealInvestor.findUnique({ where: { dealId_contactId: { dealId: intoId, contactId: r.contactId } } });
    if (existing) {
      if (r.status > existing.status || (!existing.note && r.note)) await prisma.dealInvestor.update({ where: { id: existing.id }, data: { status: Math.max(existing.status, r.status), note: existing.note || r.note } });
      await prisma.dealInvestor.delete({ where: { id: r.id } });
    } else await prisma.dealInvestor.update({ where: { id: r.id }, data: { dealId: intoId } });
  }
  const moms = await prisma.momentum.findMany({ where: { dealId: fromId } });
  for (const m of moms) {
    const clash = await prisma.momentum.findFirst({ where: { dealId: intoId, kind: m.kind, party: m.party } });
    if (clash) await prisma.momentum.delete({ where: { id: m.id } });
    else await prisma.momentum.update({ where: { id: m.id }, data: { dealId: intoId } });
  }
  const intakes = await prisma.dealIntake.findMany({ where: { dealId: fromId } });
  for (const it of intakes) {
    const taken = await prisma.dealIntake.findFirst({ where: { dealId: intoId } });
    await prisma.dealIntake.update({ where: { id: it.id }, data: taken ? { dealId: null, notes: `${it.notes ?? ""} (merged into ${into.name})`.trim() } : { dealId: intoId } });
  }
  // blanks on the surviving ticket fill from the one folded in
  const fill: Record<string, unknown> = {};
  for (const k of ["propertyAddress", "city", "state", "assetClass", "requestedAmount", "requestType", "summary", "sponsorCompanyId", "sponsorName", "units", "squareFeet", "purchasePrice", "totalCapitalization", "totalDebt", "yearBuilt", "expectedClose"] as const) {
    if ((into[k] == null || into[k] === "") && from[k] != null && from[k] !== "") fill[k] = from[k];
  }
  await prisma.deal.update({ where: { id: intoId }, data: fill });
  await prisma.dealNotDuplicate.deleteMany({ where: { OR: [{ aId: fromId }, { bId: fromId }] } });
  await prisma.deal.delete({ where: { id: fromId } });
  await prisma.activity.create({ data: { type: "NOTE", body: `Merged duplicate ticket "${from.propertyName ?? from.name}" (${from.stage}) into this deal.`, dealId: intoId, occurredAt: new Date() } }).catch(() => null);
}

export async function markNotDuplicate(aId: string, bId: string) {
  await prisma.dealNotDuplicate.upsert({ where: { aId_bId: { aId, bId } }, create: { aId, bId }, update: {} });
}
