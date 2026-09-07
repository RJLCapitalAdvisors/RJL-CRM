import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, canEditCriteria, verifySession } from "@/lib/session";

export type CurrentUser = { id: string; name: string; email: string; canEditCriteria: boolean };

/** Who is signed in (Microsoft sign-in). Null when the browser only has the shared team password. */
export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.u } });
  if (!u || !u.active || !u.email) return null;
  return { id: u.id, name: u.name, email: u.email, canEditCriteria: canEditCriteria(u.email) };
}

export async function requireCriteriaAdmin() {
  const u = await currentUser();
  if (!u?.canEditCriteria) throw new Error("Only Jonathan can change investor criteria.");
  return u;
}
