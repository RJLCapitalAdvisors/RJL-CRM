import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "@/lib/session";
import { aliasesOf, homeFor, parseWorkspaces, signInAllowed, workspacesByDomain, type Workspace } from "@/lib/access";
import { isIsraelPath } from "@/lib/workspace";

/** Step 2 of Microsoft sign-in: exchange the code, confirm who it is, match to a CRM user, set the session. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  const fail = (why: string) => NextResponse.redirect(`${base}/login?error=${encodeURIComponent(why)}`);
  const jar = await cookies();
  const saved = jar.get("rjl_oauth")?.value;
  jar.delete("rjl_oauth");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "Microsoft sign-in was cancelled");
  if (!code || !state || !saved) return fail("Sign-in expired. Try again.");
  const { state: expected, next } = JSON.parse(saved) as { state: string; next: string };
  if (state !== expected) return fail("Sign-in did not match. Try again.");

  const body = new URLSearchParams({ client_id: process.env.AZURE_CLIENT_ID!, client_secret: process.env.AZURE_CLIENT_SECRET!, grant_type: "authorization_code", code, redirect_uri: `${base}/api/auth/callback`, scope: "openid profile email User.Read" });
  const tok = (await fetch(`https://login.microsoftonline.com/${process.env.AZURE_LOGIN_TENANT ?? process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body }).then((r) => r.json())) as { access_token?: string; error_description?: string };
  if (!tok.access_token) return fail(tok.error_description?.split(".")[0] ?? "Microsoft did not return a token");

  // Ask Microsoft who this is (validates the token for us) rather than trusting the id_token blindly.
  const me = (await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json())) as { displayName?: string; mail?: string; userPrincipalName?: string; error?: unknown };
  const email = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
  if (!email) return fail("Could not read your Microsoft account");

  // the sign-in email, a person's registered RJL Israel mailbox, or the same name at the partner company finds the CRM user
  const candidates = [email, ...aliasesOf(email)];
  let user = await prisma.user.findFirst({ where: { OR: [{ email: { in: candidates, mode: "insensitive" } }, { israelEmail: { in: candidates, mode: "insensitive" } }] }, orderBy: { createdAt: "asc" } });
  const byDomain = workspacesByDomain(email);
  if (!signInAllowed(email) && !user) return fail(`${email} is not a CRM user. Ask Jonathan to add you.`);
  if (!user && byDomain.length && signInAllowed(email)) user = await prisma.user.create({ data: { name: me.displayName ?? email, email, active: true, workspaces: JSON.stringify(byDomain), israelEmail: byDomain.includes("IL") ? email : null } });
  if (!user || !user.active) return fail(`${email} is not a CRM user. Ask Jonathan to add you.`);
  await prisma.user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } }).catch(() => null);
  // this sign-in unlocks the business its email belongs to (an @rjlcapadvisors.com account opens RJL Capital
  // Advisors, an @rjlisrael.com account opens RJL Israel), within what Jonathan allows the person under Settings
  const allowed = parseWorkspaces(user.workspaces, user.email ?? email);
  const granted = byDomain.filter((x) => allowed.includes(x));
  if (!granted.length) return fail(`${email} does not open ${byDomain.includes("IL") ? "RJL Israel" : byDomain.includes("CA") ? "RJL Capital Advisors" : "the CRM"} yet. Ask Jonathan to open it for you.`);

  // someone with both businesses signs in twice, one account at a time; the second sign-in adds to the first
  const existing = await verifySession(jar.get(SESSION_COOKIE)?.value);
  const sameUser = existing && existing.u === user.id;
  const w = Array.from(new Set([...(sameUser ? existing.w ?? [] : []), ...granted]));
  const a = { ...(sameUser ? existing.a ?? {} : {}), ...Object.fromEntries(granted.map((x) => [x, email])) };
  const primary = sameUser ? existing : null;
  const value = await signSession({ u: user.id, e: primary?.e ?? email, n: user.name, x: Date.now() + SESSION_DAYS * 86_400_000, w, a });
  jar.set(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86_400 });
  const wanted = next && next.startsWith("/") ? next : homeFor(granted as Workspace[]);
  const ok = isIsraelPath(wanted) ? w.includes("IL") : w.includes("CA");
  return NextResponse.redirect(`${base}${ok ? wanted : homeFor(granted as Workspace[])}`);
}
