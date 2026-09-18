import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { workspacesByDomain } from "@/lib/access";
import { isIsraelPath, sideOfPath } from "@/lib/workspace";

/**
 * Sign-in gate for the hosted CRM. Preferred: Microsoft sign-in (signed rjl_user cookie, one person).
 * Fallback: the shared team password (APP_PASSWORD) which unlocks the app without an identity.
 * Public: login and auth routes, sponsor progress-report links, unsubscribe links, inbound-mail webhooks.
 * With no APP_PASSWORD and no Azure app configured (local development) everything is open.
 */
const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/graph\//, /^\/api\/cron\//, /^\/share\//, /^\/unsubscribe\//, /^\/api\/inbound/, /^\/api\/deals\/[^/]+\/(files\/|faq\.pdf|progress-report\.pdf)/, /^\/logo\.png$/, /^\/israel-logo\.(png|svg)$/, /^\/outlook-bridge\//, /^\/favicon/, /^\/_next\//, ...(process.env.NODE_ENV === "development" ? [/^\/dev\//] : [])]; // /dev pages exist only on a developer machine
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
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    // which business this person may open; sessions from before the split fall back to what their email domain allows
    const w = session.w?.length ? session.w : workspacesByDomain(session.e);
    const need = pathname.startsWith("/api/") ? null : sideOfPath(pathname);
    if (need && !w.includes(need)) {
      // that side is still faded: sign in with the account for it, then come back here
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?business=${need}&next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
    return withPath();
  }
  if (password) {
    const expected = await sessionToken(password, process.env.APP_SECRET ?? "dev-secret");
    if (req.cookies.get(COOKIE)?.value === expected) return withPath();
  }
  // no session at all: send the person to the sign-in for the side they were opening. Before Sep 17 an Israel page
  // sent people to the generic sign-in, Microsoft picked their RJL CA account, and RJL Israel then asked again,
  // which read as "you must log in to RJL CA first".
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  const side = pathname.startsWith("/api/") ? null : sideOfPath(pathname);
  const params = new URLSearchParams();
  if (side) params.set("business", side);
  if (pathname !== "/") params.set("next", pathname + req.nextUrl.search);
  url.search = params.toString() ? `?${params}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
