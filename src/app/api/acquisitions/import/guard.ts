import { currentUser } from "@/lib/current-user";

/** The proxy already requires a sign-in for /api; a signed-in person must also have RJL Acquisitions open. */
export async function aqUser(): Promise<{ ok: true; name: string | null } | { ok: false }> {
  const u = await currentUser();
  if (u && !u.workspaces.includes("AQ")) return { ok: false };
  return { ok: true, name: u?.name ?? null };
}
