"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCriteriaAdmin } from "@/lib/current-user";
import { workspacesByDomain } from "@/lib/access";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** Jonathan sets who opens which business, and the RJL Israel mailbox a person uses there. */
export async function updateUserAccessAction(userId: string, fd: FormData) {
  await requireCriteriaAdmin();
  const ws = fd.getAll("workspaces").map(String).filter((x) => x === "CA" || x === "IL");
  await prisma.user.update({ where: { id: userId }, data: { workspaces: JSON.stringify(ws), israelEmail: s(fd, "israelEmail")?.toLowerCase() ?? null, active: fd.get("active") === "on" } });
  revalidatePath("/settings");
}

/** A new person: their sign-in email decides the business unless Jonathan ticks otherwise. */
export async function addUserAction(fd: FormData) {
  await requireCriteriaAdmin();
  const email = s(fd, "email")?.toLowerCase();
  const name = s(fd, "name");
  if (!email || !name) return;
  const ws = fd.getAll("workspaces").map(String).filter((x) => x === "CA" || x === "IL");
  const israelEmail = s(fd, "israelEmail")?.toLowerCase() ?? (email.endsWith("@rjlisrael.com") ? email : null);
  await prisma.user.upsert({ where: { email }, create: { name, email, active: true, workspaces: JSON.stringify(ws.length ? ws : workspacesByDomain(email)), israelEmail }, update: { name, active: true, workspaces: JSON.stringify(ws.length ? ws : workspacesByDomain(email)), israelEmail } });
  revalidatePath("/settings");
}
