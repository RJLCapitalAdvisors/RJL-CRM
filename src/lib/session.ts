/**
 * Signed session cookie for Microsoft sign-in. Payload is base64url JSON {u: userId, e: email, n: name, x: expiresMs};
 * signature is HMAC-SHA256(APP_SECRET, payload) as hex. Implemented with Web Crypto so the same code runs in
 * the proxy (edge-style runtime) and in server actions.
 */
export const SESSION_COOKIE = "rjl_user";
export const SESSION_DAYS = 30;

/** w: businesses unlocked in this browser (each by its own sign-in); a: the account that unlocked each one. */
export type Session = { u: string; e: string; n: string; x: number; w?: string[]; a?: Partial<Record<"CA" | "IL" | "AQ", string>> };

const enc = new TextEncoder();
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signSession(s: Session, secret = process.env.APP_SECRET ?? "dev-secret") {
  const payload = b64url(JSON.stringify(s));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(cookie: string | undefined, secret = process.env.APP_SECRET ?? "dev-secret"): Promise<Session | null> {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(secret, payload);
  if (expected.length !== sig.length || expected !== sig) return null;
  try {
    const s = JSON.parse(unb64url(payload)) as Session;
    return s.x > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/** People allowed to change investor criteria (approve proposals, edit criteria on company pages). */
export const CRITERIA_ADMINS = (process.env.CRITERIA_ADMINS ?? "jonathan@rjlcapadvisors.com").toLowerCase().split(/[,\s]+/).filter(Boolean);
export const canEditCriteria = (email: string | null | undefined) => Boolean(email && CRITERIA_ADMINS.includes(email.toLowerCase()));
