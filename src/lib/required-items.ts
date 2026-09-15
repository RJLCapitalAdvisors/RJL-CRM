import { prisma } from "@/lib/db";
import { CHECKLIST, DEFAULT_CHECKLIST, itemLabel, setChecklist, type ChecklistItem } from "@/lib/checklist";
import { ASSET_CLASSES } from "@/lib/taxonomy";
import { IL_CATEGORIES, IL_DEFAULT_REQUIRED, IL_REQUIRED, setIlRequired, type IlCategory, type IlRequiredItem } from "@/lib/israel";

/**
 * Required Items Lists as windows. Each window is one bulleted list (one item per line) with a heading that says
 * what it is for: on RJL Capital Advisors, Acquisitions or Development plus the asset classes it covers; on RJL
 * Israel, Apartments or Houses. The first windows are the defaults, one per kind, and apply to whatever has no
 * window of its own. Jonathan edits the text; everything that asks a sponsor or an agent for something reads the
 * windows through loadChecklist / loadIlRequired, which turn the lines back into checklist items (a line that
 * matches a built-in item keeps that item's key, so the Excel model still counts only when an Excel file arrives
 * and Current occupancy still fills the occupancy field; any other line is a question of its own, key x_...).
 */

const TTL = 30_000;
let caLoadedAt = 0;
let ilLoadedAt = 0;

export type RequiredWindow = Awaited<ReturnType<typeof prisma.requiredList.findMany>>[number];
export const CA_KINDS = ["Acquisitions", "Development"] as const;
export const IL_KINDS: IlCategory[] = ["apartments", "houses", "projects"];

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
export const lines = (text: string | null | undefined): string[] => (text ?? "").split("\n").map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean);

// ---------- matching a line to a built-in item ----------
const STOP = new Set(["the", "and", "for", "with", "does", "how", "what", "any", "are", "there", "this", "that", "each", "per", "its", "into", "from", "yes", "not", "own"]);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
function matchLine<T>(line: string, pool: T[], labelsOf: (t: T) => string[]): T | null {
  const L = tokens(line);
  if (!L.size) return null;
  let best: T | null = null, bestScore = 0;
  for (const it of pool) {
    for (const label of labelsOf(it)) {
      const P = tokens(label);
      if (!P.size) continue;
      let hit = 0;
      for (const w of L) if (P.has(w)) hit++;
      const union = new Set([...L, ...P]).size;
      const jaccard = hit / union;
      const contained = hit === Math.min(L.size, P.size) && Math.min(L.size, P.size) >= 2;
      const score = jaccard >= 0.6 || contained ? jaccard + (contained ? 0.5 : 0) : 0;
      if (score > bestScore) { bestScore = score; best = it; }
    }
  }
  return best;
}

// ---------- RJL Capital Advisors ----------
const RESIDENTIAL = ["Multifamily", "Build-For-Rent (SFR)", "Student Housing", "Senior Housing", "Mixed Use"];
const strat = (s: "Acquisitions" | "Development") => DEFAULT_CHECKLIST.filter((it) => it.strategy.includes(s));
const textOf = (items: ChecklistItem[], s: "Acquisitions" | "Development") => items.map((it) => itemLabel(it, s)).join("\n");
/** The windows the code defaults become on the first read: two defaults, then the classes that differ today. */
function caSeed() {
  const acq = strat("Acquisitions"), dev = strat("Development");
  return [
    { kind: "Acquisitions", isDefault: true, assetClasses: null, text: textOf(acq.filter((it) => !it.onlyAssetClasses), "Acquisitions") },
    { kind: "Development", isDefault: true, assetClasses: null, text: textOf(dev.filter((it) => !it.onlyAssetClasses), "Development") },
    { kind: "Acquisitions", isDefault: false, assetClasses: JSON.stringify(RESIDENTIAL), text: textOf(acq.filter((it) => !it.onlyAssetClasses || it.onlyAssetClasses.some((c) => RESIDENTIAL.includes(c))), "Acquisitions") },
    { kind: "Acquisitions", isDefault: false, assetClasses: JSON.stringify(["Land"]), text: textOf(acq.filter((it) => !it.onlyAssetClasses && !it.excludeAssetClasses?.includes("Land")), "Acquisitions") },
    { kind: "Development", isDefault: false, assetClasses: JSON.stringify(["Land"]), text: textOf(dev.filter((it) => !it.onlyAssetClasses && !it.excludeAssetClasses?.includes("Land")), "Development") },
  ].map((w, i) => ({ ...w, workspace: "CA", sortOrder: i }));
}

export async function caWindows(): Promise<RequiredWindow[]> {
  let rows = await prisma.requiredList.findMany({ where: { workspace: "CA" }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });
  if (!rows.length) {
    await prisma.requiredList.createMany({ data: caSeed() });
    rows = await prisma.requiredList.findMany({ where: { workspace: "CA" }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });
  }
  return rows;
}

/** One window's lines as checklist items scoped to the window's kind and asset classes. */
function caItems(w: RequiredWindow, onlyAssetClasses: string[] | undefined): ChecklistItem[] {
  const s = w.kind === "Development" ? "Development" : "Acquisitions";
  return lines(w.text).map((line) => {
    const m = matchLine(line, strat(s), (it) => [it.label, it.devLabel ?? ""]) ?? matchLine(line, DEFAULT_CHECKLIST, (it) => [it.label, it.devLabel ?? ""]);
    if (m) return { key: m.key, label: line, question: m.question, kind: m.kind, strategy: [s], onlyAssetClasses, core: m.core };
    return { key: customKey(line), label: line, question: line, kind: "text", strategy: [s], onlyAssetClasses };
  });
}

/** Turn the windows into the live CHECKLIST: specific windows for their classes, the default for every other class. */
export function checklistFromWindows(rows: RequiredWindow[]): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const s of CA_KINDS) {
    const specific = rows.filter((w) => w.kind === s && !w.isDefault && parseList(w.assetClasses).length);
    const covered = new Set(specific.flatMap((w) => parseList(w.assetClasses)));
    for (const w of specific) out.push(...caItems(w, parseList(w.assetClasses)));
    const def = rows.find((w) => w.kind === s && w.isDefault);
    if (def) out.push(...caItems(def, covered.size ? ASSET_CLASSES.filter((c) => !covered.has(c)) : undefined));
  }
  return out;
}

export async function loadChecklist(force = false): Promise<ChecklistItem[]> {
  if (!force && Date.now() - caLoadedAt < TTL) return CHECKLIST;
  try {
    setChecklist(checklistFromWindows(await caWindows()));
    caLoadedAt = Date.now();
  } catch (e) {
    console.error("required items: could not load the RJL CA windows, using the code defaults", String(e).slice(0, 200));
  }
  return CHECKLIST;
}

// ---------- RJL Israel ----------
export async function ilWindows(): Promise<RequiredWindow[]> {
  let rows = await prisma.requiredList.findMany({ where: { workspace: "IL" }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });
  if (!rows.length) {
    await prisma.requiredList.createMany({ data: IL_KINDS.map((k, i) => ({ workspace: "IL", kind: k, isDefault: true, assetClasses: null, text: IL_DEFAULT_REQUIRED[k].map((it) => it.label).join("\n"), sortOrder: i })) });
    rows = await prisma.requiredList.findMany({ where: { workspace: "IL" }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });
  }
  return rows;
}

export function ilListsFromWindows(rows: RequiredWindow[]): Record<IlCategory, IlRequiredItem[]> {
  const out = { projects: [], apartments: [], houses: [] } as Record<IlCategory, IlRequiredItem[]>;
  for (const c of IL_CATEGORIES) {
    const seen = new Set<string>();
    for (const w of rows.filter((w) => w.kind === c.key)) {
      for (const line of lines(w.text)) {
        const m = matchLine(line, IL_DEFAULT_REQUIRED[c.key], (it) => [it.label]);
        const key = m?.key ?? customKey(line);
        if (seen.has(key)) continue;
        seen.add(key);
        out[c.key].push({ key, label: line, question: line });
      }
    }
  }
  return out;
}

export async function loadIlRequired(force = false): Promise<typeof IL_REQUIRED> {
  if (!force && Date.now() - ilLoadedAt < TTL) return IL_REQUIRED;
  try {
    setIlRequired(ilListsFromWindows(await ilWindows()));
    ilLoadedAt = Date.now();
  } catch (e) {
    console.error("required items: could not load the RJL Israel windows, using the code defaults", String(e).slice(0, 200));
  }
  return IL_REQUIRED;
}

export function invalidateRequiredItems() {
  caLoadedAt = 0;
  ilLoadedAt = 0;
}
