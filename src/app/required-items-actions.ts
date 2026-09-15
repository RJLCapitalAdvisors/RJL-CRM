"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { customKey, invalidateRequiredItems, loadChecklist, loadIlRequired } from "@/lib/required-items";
import { stripDashes } from "@/lib/style";

/**
 * Edits on the Required Items Lists pages. A seeded item (one that fills a ticket field) can be reworded, moved or
 * switched off, never deleted; an item Jonathan adds is a question with no field of its own (key x_...) and can go.
 */

export type RequiredItemPatch = { label?: string; devLabel?: string | null; question?: string | null; kind?: string; strategies?: string[]; assetClasses?: string[] | null; active?: boolean };

const KINDS = new Set(["short", "text", "number", "yesno", "doc"]);
const pagesFor = (workspace: string) => (workspace === "IL" ? ["/israel/required-items", "/israel"] : ["/templates/required-items", "/intake"]);

async function refresh(workspace: string) {
  invalidateRequiredItems();
  if (workspace === "IL") await loadIlRequired(true);
  else await loadChecklist(true);
  for (const p of pagesFor(workspace)) revalidatePath(p);
}

export async function addRequiredItem(workspace: "CA" | "IL", category: string, fd: FormData) {
  const label = stripDashes(String(fd.get("label") ?? "").trim());
  if (!label) return;
  const question = stripDashes(String(fd.get("question") ?? "").trim()) || null;
  const kind = KINDS.has(String(fd.get("kind"))) ? String(fd.get("kind")) : "text";
  const strategies = workspace === "CA" ? ["Acquisitions", "Development"].filter((s) => fd.getAll("strategies").includes(s)) : [];
  if (workspace === "CA" && !strategies.length) strategies.push("Acquisitions", "Development");
  const last = await prisma.requiredItem.findFirst({ where: { workspace, category }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  let key = customKey(label);
  if (await prisma.requiredItem.findUnique({ where: { workspace_category_key: { workspace, category, key } } })) key = `${key}_${Date.now().toString(36)}`;
  await prisma.requiredItem.create({ data: { workspace, category, key, label, question, kind, strategies: JSON.stringify(strategies), assetClasses: null, sortOrder: (last?.sortOrder ?? -1) + 1 } });
  await refresh(workspace);
}

export async function saveRequiredItem(id: string, patch: RequiredItemPatch) {
  const cur = await prisma.requiredItem.findUnique({ where: { id } });
  if (!cur) return;
  const data: Record<string, unknown> = {};
  if (patch.label != null && patch.label.trim()) data.label = stripDashes(patch.label.trim());
  if ("devLabel" in patch) data.devLabel = patch.devLabel?.trim() ? stripDashes(patch.devLabel.trim()) : null;
  if ("question" in patch) data.question = patch.question?.trim() ? stripDashes(patch.question.trim()) : null;
  if (patch.kind && KINDS.has(patch.kind) && !cur.core) data.kind = patch.kind;
  if (patch.strategies) data.strategies = JSON.stringify(patch.strategies.filter((s) => s === "Acquisitions" || s === "Development"));
  if ("assetClasses" in patch) data.assetClasses = patch.assetClasses && patch.assetClasses.length ? JSON.stringify(patch.assetClasses) : null;
  if (patch.active != null) data.active = patch.active;
  await prisma.requiredItem.update({ where: { id }, data });
  await refresh(cur.workspace);
}

export async function deleteRequiredItem(id: string) {
  const cur = await prisma.requiredItem.findUnique({ where: { id } });
  if (!cur) return;
  if (!cur.key.startsWith("x_")) {
    await prisma.requiredItem.update({ where: { id }, data: { active: false } }); // a ticket field cannot go; it is switched off
  } else await prisma.requiredItem.delete({ where: { id } });
  await refresh(cur.workspace);
}

export async function moveRequiredItem(id: string, dir: -1 | 1) {
  const cur = await prisma.requiredItem.findUnique({ where: { id } });
  if (!cur) return;
  const rows = await prisma.requiredItem.findMany({ where: { workspace: cur.workspace, category: cur.category }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await prisma.$transaction(rows.map((r, k) => prisma.requiredItem.update({ where: { id: r.id }, data: { sortOrder: k } })));
  await refresh(cur.workspace);
}
