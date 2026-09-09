import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Sign-in gate for the hosted CRM. Preferred: Microsoft sign-in (signed rjl_user cookie, one person).
 * Fallback: the shared team password (APP_PASSWORD) which unlocks the app without an identity.
 * Public: login and auth routes, sponsor progress-report links, unsubscribe links, inbound-mail webhooks.
 * With no APP_PASSWORD and no Azure app configured (local development) everything is open.
 */
const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/graph\//, /^\/api\/cron\//, /^\/share\//, /^\/unsubscribe\//, /^\/api\/inbound/, /^\/api\/deals\/[^/]+\/(files\/|faq\.pdf|progress-report\.pdf)/, /^\/logo\.png$/, /^\/israel-logo\.png$/, /^\/outlook-bridge\//, /^\/favicon/, /^\/_next\//];
export const COOKIE = "rjl_session";

export async function sessionToken(password: string, secret: string) {
  const bytes = new TextEncoder().encode(`${secret}:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const gated = Boolean(password || process.env.AZURE_CLIENT_ID);
  const { pathname } = req.nextUrl;
  // the root layout reads this to decide which shell (RJL Capital Advisors or RJL Israel) wraps the page
  const withPath = () => {
    const h = new Headers(req.headers);
    h.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: h } });
  };
  if (!gated) return withPath();
  if (PUBLIC.some((re) => re.test(pathname))) return withPath();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return withPath();
  if (password) {
    const expected = await sessionToken(password, process.env.APP_SECRET ?? "dev-secret");
    if (req.cookies.get(COOKIE)?.value === expected) return withPath();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
