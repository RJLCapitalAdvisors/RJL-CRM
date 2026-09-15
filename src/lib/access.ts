/**
 * Which business a person can open. Decided by their email: an @rjlcapadvisors.com (or @rjlequities.com) address
 * opens RJL Capital Advisors, an @rjlisrael.com address opens RJL Israel, and a person who has both addresses
 * (Jonathan) opens both. Jonathan can widen or narrow anyone's access under Settings. The session cookie carries
 * the list so the sign-in gate can check it without a database.
 */
export type Workspace = "CA" | "IL";
export const CA_DOMAINS = ["rjlcapadvisors.com", "rjlequities.com"];
/** RJL Israel's partner company. Only the people Jonathan listed may sign in from it (Sep 15, 2026); nobody from any other domain. */
export const PARTNER_DOMAIN = "liviemisrael.com";
export const PARTNER_PEOPLE = ["farshid", "elisheva", "fariba", "ohad", "leon", "shawn", "jonathan", "yitzchak"];
const IL_MAIL_DOMAIN = process.env.ISRAEL_DEALS_MAILBOX?.split("@")[1]?.toLowerCase() ?? "rjlisrael.com";
export const IL_DOMAINS = [IL_MAIL_DOMAIN, "rjlisrael.com", PARTNER_DOMAIN].filter((d, i, a) => a.indexOf(d) === i);

export const domainOf = (email: string | null | undefined) => (email ?? "").toLowerCase().split("@")[1] ?? "";
export const localPartOf = (email: string | null | undefined) => (email ?? "").toLowerCase().split("@")[0] ?? "";

/** Whether an address may sign in or be added at all: RJL CA, RJL Israel, or a listed person at the partner company. No other domains for now. */
export function signInAllowed(email: string | null | undefined): boolean {
  const d = domainOf(email);
  if (CA_DOMAINS.includes(d)) return true;
  if (d === PARTNER_DOMAIN) return PARTNER_PEOPLE.includes(localPartOf(email));
  return IL_DOMAINS.includes(d);
}

/** Other addresses that are the same person: jonathan@liviemisrael.com is jonathan@rjlisrael.com (same first names on both sides). */
export function aliasesOf(email: string | null | undefined): string[] {
  const d = domainOf(email), l = localPartOf(email);
  if (!l) return [];
  if (d === PARTNER_DOMAIN) return [`${l}@rjlisrael.com`, `${l}@${IL_MAIL_DOMAIN}`].filter((x, i, a) => a.indexOf(x) === i);
  if (IL_DOMAINS.includes(d)) return [`${l}@${PARTNER_DOMAIN}`];
  return [];
}

/**
 * Which mailboxes each side reads, so the two email logs stay apart: RJL Capital Advisors reads @rjlcapadvisors.com
 * (and @rjlequities.com) mailboxes only, RJL Israel reads @rjlisrael.com mailboxes only. Partner mailboxes sit in
 * another tenant and are never read; a person's RJL Israel address never feeds the RJL CA log and vice versa.
 */
export const isCaMailbox = (email: string | null | undefined) => CA_DOMAINS.includes(domainOf(email));
export const isIlMailbox = (email: string | null | undefined) => domainOf(email) === IL_MAIL_DOMAIN || domainOf(email) === "rjlisrael.com";

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
