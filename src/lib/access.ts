/**
 * Which business a person can open. Decided by their email: an @rjlcapadvisors.com (or @rjlequities.com) address
 * opens RJL Capital Advisors, an @rjlisrael.com address opens RJL Israel, and a person who has both addresses
 * (Jonathan) opens both. Jonathan can widen or narrow anyone's access under Settings. The session cookie carries
 * the list so the sign-in gate can check it without a database.
 */
export type Workspace = "CA" | "IL";
export const CA_DOMAINS = ["rjlcapadvisors.com", "rjlequities.com"];
export const IL_DOMAINS = [process.env.ISRAEL_DEALS_MAILBOX?.split("@")[1]?.toLowerCase() ?? "rjlisrael.com", "rjlisrael.com"].filter((d, i, a) => a.indexOf(d) === i);

export const domainOf = (email: string | null | undefined) => (email ?? "").toLowerCase().split("@")[1] ?? "";

/** What the email address alone entitles a person to. */
export function workspacesByDomain(email: string | null | undefined): Workspace[] {
  const d = domainOf(email);
  if (CA_DOMAINS.includes(d)) return ["CA"];
  if (IL_DOMAINS.includes(d)) return ["IL"];
  return [];
}

export function parseWorkspaces(stored: string | null | undefined, email?: string | null): Workspace[] {
  try {
    const v = JSON.parse(stored ?? "[]") as string[];
    const list = v.filter((x): x is Workspace => x === "CA" || x === "IL");
    if (list.length) return list;
  } catch {
    /* fall through */
  }
  return workspacesByDomain(email);
}

export const homeFor = (w: Workspace[]) => (w.includes("CA") ? "/" : w.includes("IL") ? "/israel" : "/login?error=" + encodeURIComponent("Your account has no CRM access yet. Ask Jonathan."));
