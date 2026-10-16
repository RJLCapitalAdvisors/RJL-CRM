"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { usdIls, type FxRate } from "@/lib/fx";
import { IL_REQUIRED, apartmentMissing, compactMissing, houseMissing, projectMissing } from "@/lib/israel";
import { loadIlRequired } from "@/lib/required-items";

export type QueueKind = "apartments" | "houses" | "projects";

const table = (kind: QueueKind) => (kind === "apartments" ? prisma.ilApartment : kind === "houses" ? prisma.ilHouse : prisma.ilProject) as unknown as {
  findUnique: (a: { where: { id: string }; omit?: Record<string, boolean>; include?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
  update: (a: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};
const omitBig = (kind: QueueKind): Record<string, boolean> => (kind === "projects" ? { brochure: true } : { floorplan: true });
const missingFor = (kind: QueueKind, row: Record<string, unknown>) => (kind === "apartments" ? apartmentMissing(row) : kind === "houses" ? houseMissing(row) : compactMissing(projectMissing(row)));
const refresh = (kind: QueueKind, id: string) => {
  for (const p of ["/israel", "/israel/queue", `/israel/${kind}`, `/israel/${kind}/${id}`, "/israel/houses/map"]) revalidatePath(p);
};
const note = async (kind: QueueKind, id: string, body: string) => {
  const data = kind === "apartments" ? { apartmentId: id, body } : kind === "houses" ? { houseId: id, body } : { projectId: id, body };
  await prisma.ilNote.create({ data }).catch(() => null);
};

/** What is still blank on a ticket's Required Items List, read fresh (after every save in the fill panel). */
export async function queueMissing(kind: QueueKind, id: string): Promise<string[]> {
  await loadIlRequired();
  const row = await table(kind).findUnique({ where: { id }, omit: omitBig(kind), include: { developer: { select: { name: true } } } });
  return row ? missingFor(kind, row) : [];
}

/**
 * Form names on the ticket forms that the Required Items List keys answer, for the red asterisks in the fill panel
 * (Jonathan, Oct 16, 2026). A key with no form field (the floorplan, the brochure) is named separately.
 */
const FORM_NAMES: Record<string, string[]> = {
  developerId: ["developers"], street: ["street"], sukka: ["sukka", "mirpasotSukka"], mirpesetDirection: ["mirpesetDirection", "mirpasotDir"], mirpesetSqm: ["mirpesetSqm", "mirpasotSqm", "mirpesetTotalSqm"], ceilingCms: ["ceilingCm"], amenities: ["amenity:"],
};
const NO_FORM_FIELD = new Set(["floorplanName", "brochureName"]);

export type QueueTicket = {
  row: Record<string, unknown>;
  fx: FxRate | null;
  projects: { id: string; name: string; city: string | null }[];
  developers: { id: string; name: string }[];
  missing: string[];
  requiredNames: string[];
  elsewhere: string[]; // required items with no field on the form (set on the ticket page)
};

/** Everything the fill panel needs for one ticket: the row, the lists the forms want, and what is still required. */
export async function queueTicketData(kind: QueueKind, id: string): Promise<QueueTicket | null> {
  await loadIlRequired();
  const row = await table(kind).findUnique({ where: { id }, omit: omitBig(kind), include: { developer: { select: { name: true } } } });
  if (!row) return null;
  const [fx, projects, developers] = await Promise.all([
    usdIls().catch(() => null),
    kind === "projects" ? Promise.resolve([]) : prisma.ilProject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    kind === "projects" ? prisma.ilCompany.findMany({ where: { OR: [{ roles: { contains: "Sponsor" } }, { projects: { some: { id } } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const list = IL_REQUIRED[kind];
  const requiredNames = list.flatMap((it) => (kind === "apartments" && it.key === "developerId" ? [] : (FORM_NAMES[it.key] ?? [it.key])));
  const missing = missingFor(kind, row);
  const elsewhere = list.filter((it) => NO_FORM_FIELD.has(it.key) || (kind === "apartments" && it.key === "developerId")).filter((it) => missing.includes(it.label)).map((it) => it.label);
  return { row, fx, projects, developers, missing, requiredNames, elsewhere };
}

/**
 * Approve from The Que (Sep 22, 2026; strict since Oct 16, 2026): only a ticket whose Required Items List is complete goes
 * into the system. With something still blank the fill panel is the way through; there is no approving around it.
 */
export async function queueApprove(kind: QueueKind, id: string): Promise<{ ok: true } | { ok: false; reason: string; missing: string[] }> {
  await loadIlRequired();
  const me = await currentUser();
  const row = await table(kind).findUnique({ where: { id }, omit: omitBig(kind), include: { developer: { select: { name: true } } } });
  if (!row) return { ok: false, reason: "That deal is gone.", missing: [] };
  const missing = missingFor(kind, row);
  if (missing.length) return { ok: false, reason: `${missing.length} required item${missing.length === 1 ? " is" : "s are"} still blank.`, missing };
  await table(kind).update({ where: { id }, data: { pendingApproval: false, approvalRequestedAt: null, approvalRequestedBy: null } });
  await note(kind, id, `Approved from The Que by ${me?.name ?? "the team"}: data complete.`);
  refresh(kind, id);
  return { ok: true };
}
