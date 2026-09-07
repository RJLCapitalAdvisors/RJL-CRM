import { NextResponse, type NextRequest } from "next/server";

/**
 * Sign-in gate for the hosted CRM. Until Microsoft sign-in arrives with the M365 connection, one
 * shared password (APP_PASSWORD) unlocks the app; a signed cookie remembers the browser for 30 days.
 * Public: the login page, sponsor progress-report links, unsubscribe links, inbound-mail webhooks.
 * With no APP_PASSWORD set (local development) everything is open.
 */
const PUBLIC = [/^\/login/, /^\/share\//, /^\/unsubscribe\//, /^\/api\/inbound/, /^\/logo\.png$/, /^\/favicon/, /^\/_next\//];
export const COOKIE = "rjl_session";

export async function sessionToken(password: string, secret: string) {
  const bytes = new TextEncoder().encode(`${secret}:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const expected = await sessionToken(password, process.env.APP_SECRET ?? "dev-secret");
  if (req.cookies.get(COOKIE)?.value === expected) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
