import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => process.env.APP_SECRET ?? "dev-secret";

/** Signed, URL-safe token for a contact id (used in unsubscribe links). */
export function signContactToken(contactId: string): string {
  const sig = createHmac("sha256", secret()).update(contactId).digest("base64url").slice(0, 24);
  return `${contactId}.${sig}`;
}

export function verifyContactToken(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const id = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret()).update(id).digest("base64url").slice(0, 24);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

export function unsubscribeUrl(contactId: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/unsubscribe/${signContactToken(contactId)}`;
}

/** Capability link for one file: HMAC over "file:<id>" or "faq:<dealId>". */
export function signFileToken(subject: string): string {
  const sig = createHmac("sha256", secret()).update(subject).digest("base64url").slice(0, 24);
  return `${Buffer.from(subject, "utf8").toString("base64url")}.${sig}`;
}
export function verifyFileToken(token: string): string | null {
  const [b, sig] = token.split(".");
  if (!b || !sig) return null;
  const subject = Buffer.from(b, "base64url").toString("utf8");
  const expected = createHmac("sha256", secret()).update(subject).digest("base64url").slice(0, 24);
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? subject : null;
}
