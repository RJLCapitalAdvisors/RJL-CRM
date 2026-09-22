"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { apartmentMissing, houseMissing, projectMissing } from "@/lib/israel";
import { loadIlRequired } from "@/lib/required-items";

export type QueueKind = "apartments" | "houses" | "projects";

const table = (kind: QueueKind) => (kind === "apartments" ? prisma.ilApartment : kind === "houses" ? prisma.ilHouse : prisma.ilProject) as unknown as {
  findUnique: (a: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
  update: (a: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};
const missingFor = (kind: QueueKind, row: Record<string, unknown>) => (kind === "apartments" ? apartmentMissing(row) : kind === "houses" ? houseMissing(row) : projectMissing(row));
const refresh = (kind: QueueKind, id: string) => {
  for (const p of ["/israel", "/israel/queue", `/israel/${kind}`, `/israel/${kind}/${id}`, "/israel/houses/map"]) revalidatePath(p);
};
const note = async (kind: QueueKind, id: string, body: string) => {
  const data = kind === "apartments" ? { apartmentId: id, body } : kind === "houses" ? { houseId: id, body } : { projectId: id, body };
  await prisma.ilNote.create({ data }).catch(() => null);
};

/**
 * Approve from The Que (Sep 22, 2026). Complete data goes straight into the system. A person can also push a deal
 * through with data still missing: Jonathan's own click admits it at once; anyone else's sends it to Jonathan's
 * dashboard (Deals to be approved), where his Approve admits it regardless of what is missing.
 */
export async function queueApprove(kind: QueueKind, id: string): Promise<{ ok: true; where: "system" | "dashboard" } | { ok: false; reason: string }> {
  await loadIlRequired();
  const me = await currentUser();
  const row = await table(kind).findUnique({ where: { id } });
  if (!row) return { ok: false, reason: "That deal is gone." };
  const missing = missingFor(kind, row);
  if (missing.length === 0 || me?.canEditCriteria) {
    await table(kind).update({ where: { id }, data: { pendingApproval: false, approvalRequestedAt: null, approvalRequestedBy: null } });
    await note(kind, id, missing.length ? `Approved into the system by ${me?.name ?? "the team"} with data still missing: ${missing.join(", ")}.` : `Approved from The Que by ${me?.name ?? "the team"}: data complete.`);
    refresh(kind, id);
    return { ok: true, where: "system" };
  }
  await table(kind).update({ where: { id }, data: { approvalRequestedAt: new Date(), approvalRequestedBy: me?.name ?? "the team" } });
  await note(kind, id, `${me?.name ?? "The team"} approved this from The Que with data still missing (${missing.join(", ")}); waiting on Jonathan.`);
  refresh(kind, id);
  return { ok: true, where: "dashboard" };
}

/** Jonathan's Approve on the dashboard: into the system, whatever is still missing. */
export async function dashboardApprove(kind: QueueKind, id: string) {
  const me = await currentUser();
  if (!me?.canEditCriteria) return;
  const row = await table(kind).findUnique({ where: { id } });
  if (!row) return;
  await loadIlRequired();
  const missing = missingFor(kind, row);
  await table(kind).update({ where: { id }, data: { pendingApproval: false, approvalRequestedAt: null, approvalRequestedBy: null } });
  await note(kind, id, missing.length ? `Approved by ${me.name} with data still missing: ${missing.join(", ")}.` : `Approved by ${me.name}: data complete.`);
  refresh(kind, id);
}

/** Back to The Que without a decision: clears a colleague's request. */
export async function dashboardDecline(kind: QueueKind, id: string) {
  const me = await currentUser();
  if (!me?.canEditCriteria) return;
  await table(kind).update({ where: { id }, data: { approvalRequestedAt: null, approvalRequestedBy: null } });
  await note(kind, id, `${me.name} sent this back to The Que; the missing data is still needed.`);
  refresh(kind, id);
}
