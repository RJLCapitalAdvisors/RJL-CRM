import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, canEditCriteria, verifySession } from "@/lib/session";
import { parseWorkspaces, workspacesByDomain, type Workspace } from "@/lib/access";

export type CurrentUser = { id: string; name: string; email: string; canEditCriteria: boolean; workspaces: Workspace[]; granted: Workspace[]; accounts: Partial<Record<Workspace, string>>; israelEmail: string | null };

/** Who is signed in (Microsoft sign-in). Null when the browser only has the shared team password. */
export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.u } });
  if (!u || !u.active || !u.email) return null;
  // unlocked in this browser: what the sign-ins so far granted (older cookies: the sign-in email's own side)
  const unlocked = (s.w?.length ? s.w : workspacesByDomain(s.e)).filter((x): x is Workspace => x === "CA" || x === "IL" || x === "AQ");
  return { id: u.id, name: u.name, email: u.email, canEditCriteria: canEditCriteria(u.email), workspaces: unlocked, granted: parseWorkspaces(u.workspaces, u.email), accounts: s.a ?? {}, israelEmail: u.israelEmail };
}

export async function requireCriteriaAdmin() {
  const u = await currentUser();
  if (!u?.canEditCriteria) throw new Error("Only Jonathan can change investor criteria.");
  return u;
}
