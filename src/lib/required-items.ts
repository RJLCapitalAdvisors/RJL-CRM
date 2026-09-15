import { prisma } from "@/lib/db";
import { CHECKLIST, DEFAULT_CHECKLIST, setChecklist, type ChecklistItem, type ItemKind } from "@/lib/checklist";
import { ASSET_CLASSES } from "@/lib/taxonomy";
import { IL_CATEGORIES, IL_DEFAULT_REQUIRED, IL_REQUIRED, setIlRequired, type IlCategory, type IlRequiredItem } from "@/lib/israel";

/**
 * Required Items Lists. Jonathan edits them on two pages (Templates > Required Items Lists for RJL Capital Advisors,
 * Required Items Lists under Deals for RJL Israel); everything that asks a sponsor or an agent for something reads
 * the lists from here: the deals mailboxes, Still needed on a ticket, Items Needed on a progress report, Ask the CRM.
 * The lists live in RequiredItem rows. The first read seeds them from the defaults in code (checklist.ts and
 * israel.ts); after that the code defaults are only a fallback when the database cannot be reached.
 * loadChecklist / loadIlRequired swap the live in-memory lists, cached for half a minute per server instance.
 */

const TTL = 30_000;
let caLoadedAt = 0;
let ilLoadedAt = 0;

export type RequiredItemRow = Awaited<ReturnType<typeof prisma.requiredItem.findMany>>[number];

/** A stable key for a question with no ticket field: x_ plus the label's words. */
export function customKey(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `x_${slug || "item"}`;
}

export const parseList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

// ---------- RJL Capital Advisors ----------

async function seedCA() {
  const rows = DEFAULT_CHECKLIST.map((it, i) => ({
    workspace: "CA",
    category: "deal",
    key: it.key,
    label: it.label,
    devLabel: it.devLabel ?? null,
    question: it.question,
    kind: it.kind,
    strategies: JSON.stringify(it.strategy),
    assetClasses: it.onlyAssetClasses ? JSON.stringify(it.onlyAssetClasses) : it.excludeAssetClasses ? JSON.stringify(ASSET_CLASSES.filter((c) => !it.excludeAssetClasses!.includes(c))) : null,
    core: it.core ?? null,
    sortOrder: i,
  }));
  await prisma.requiredItem.createMany({ data: rows, skipDuplicates: true });
}

/** The RJL CA rows in order, seeded from the code defaults when the table is empty. */
export async function caRequiredItems(): Promise<RequiredItemRow[]> {
  let rows = await prisma.requiredItem.findMany({ where: { workspace: "CA", category: "deal" }, orderBy: { sortOrder: "asc" } });
  if (!rows.length) {
    await seedCA();
    rows = await prisma.requiredItem.findMany({ where: { workspace: "CA", category: "deal" }, orderBy: { sortOrder: "asc" } });
  }
  return rows;
}

export function toChecklistItem(r: RequiredItemRow): ChecklistItem {
  const only = r.assetClasses ? parseList(r.assetClasses) : null;
  return {
    key: r.key,
    label: r.label,
    devLabel: r.devLabel ?? undefined,
    question: r.question ?? r.label,
    kind: (["short", "text", "number", "yesno", "doc"].includes(r.kind) ? r.kind : "text") as ItemKind,
    strategy: parseList(r.strategies).filter((s): s is "Acquisitions" | "Development" => s === "Acquisitions" || s === "Development"),
    onlyAssetClasses: only && only.length ? only : undefined,
    core: (r.core as ChecklistItem["core"]) ?? undefined,
  };
}

/** Put Jonathan's list into CHECKLIST (the live list every checklist function reads). Safe to call often. */
export async function loadChecklist(force = false): Promise<ChecklistItem[]> {
  if (!force && Date.now() - caLoadedAt < TTL) return CHECKLIST;
  try {
    const rows = await caRequiredItems();
    setChecklist(rows.filter((r) => r.active).map(toChecklistItem));
    caLoadedAt = Date.now();
  } catch (e) {
    console.error("required items: could not load the RJL CA list, using the code defaults", String(e).slice(0, 200));
  }
  return CHECKLIST;
}

// ---------- RJL Israel ----------

async function seedIL(category: IlCategory) {
  await prisma.requiredItem.createMany({
    data: IL_DEFAULT_REQUIRED[category].map((it, i) => ({ workspace: "IL", category, key: it.key, label: it.label, question: it.question ?? null, kind: "text", sortOrder: i })),
    skipDuplicates: true,
  });
}

export async function ilRequiredItems(category: IlCategory): Promise<RequiredItemRow[]> {
  let rows = await prisma.requiredItem.findMany({ where: { workspace: "IL", category }, orderBy: { sortOrder: "asc" } });
  if (!rows.length) {
    await seedIL(category);
    rows = await prisma.requiredItem.findMany({ where: { workspace: "IL", category }, orderBy: { sortOrder: "asc" } });
  }
  return rows;
}

export async function loadIlRequired(force = false): Promise<typeof IL_REQUIRED> {
  if (!force && Date.now() - ilLoadedAt < TTL) return IL_REQUIRED;
  try {
    const lists: Partial<Record<IlCategory, IlRequiredItem[]>> = {};
    for (const c of IL_CATEGORIES) {
      const rows = await ilRequiredItems(c.key);
      lists[c.key] = rows.filter((r) => r.active).map((r) => ({ key: r.key, label: r.label, question: r.question }));
    }
    setIlRequired(lists);
    ilLoadedAt = Date.now();
  } catch (e) {
    console.error("required items: could not load the RJL Israel lists, using the code defaults", String(e).slice(0, 200));
  }
  return IL_REQUIRED;
}

/** Forget the cache so the next load reads the edit that was just saved. */
export function invalidateRequiredItems() {
  caLoadedAt = 0;
  ilLoadedAt = 0;
}
