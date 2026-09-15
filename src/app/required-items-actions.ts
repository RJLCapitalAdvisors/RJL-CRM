"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { invalidateRequiredItems, loadChecklist, loadIlRequired } from "@/lib/required-items";
import { stripDashes } from "@/lib/style";
import { ASSET_CLASSES } from "@/lib/taxonomy";

/** Edits on the Required Items Lists pages: a window's text, what it is for, a new window, a window removed. The two default windows only change their text. */

const PAGES = (workspace: string) => (workspace === "IL" ? ["/israel/required-items", "/israel"] : ["/templates/required-items", "/intake"]);
async function refresh(workspace: string) {
  invalidateRequiredItems();
  if (workspace === "IL") await loadIlRequired(true);
  else await loadChecklist(true);
  for (const p of PAGES(workspace)) revalidatePath(p);
}
const KINDS: Record<string, string[]> = { CA: ["Acquisitions", "Development"], IL: ["apartments", "houses", "projects"] };

export async function addRequiredList(workspace: "CA" | "IL") {
  const last = await prisma.requiredList.findFirst({ where: { workspace }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await prisma.requiredList.create({ data: { workspace, kind: KINDS[workspace][0], isDefault: false, assetClasses: workspace === "CA" ? "[]" : null, text: "", sortOrder: (last?.sortOrder ?? -1) + 1 } });
  await refresh(workspace);
}

export async function saveRequiredList(id: string, patch: { text?: string; kind?: string; assetClasses?: string[] }) {
  const cur = await prisma.requiredList.findUnique({ where: { id } });
  if (!cur) return;
  const data: Record<string, unknown> = {};
  if (patch.text != null) data.text = stripDashes(patch.text).split("\n").map((l) => l.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean).join("\n");
  if (!cur.isDefault) {
    if (patch.kind && KINDS[cur.workspace].includes(patch.kind)) data.kind = patch.kind;
    if (patch.assetClasses && cur.workspace === "CA") data.assetClasses = JSON.stringify(patch.assetClasses.filter((c) => (ASSET_CLASSES as readonly string[]).includes(c)));
  }
  await prisma.requiredList.update({ where: { id }, data });
  await refresh(cur.workspace);
}

export async function deleteRequiredList(id: string) {
  const cur = await prisma.requiredList.findUnique({ where: { id } });
  if (!cur || cur.isDefault) return;
  await prisma.requiredList.delete({ where: { id } });
  await refresh(cur.workspace);
}
