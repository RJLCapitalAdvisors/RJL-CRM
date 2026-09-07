import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

/** Step 1 of Microsoft sign-in: send the browser to Microsoft. */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("rjl_oauth", JSON.stringify({ state, next }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const base = (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const params = new URLSearchParams({
    client_id: process.env.AZURE_CLIENT_ID!,
    response_type: "code",
    redirect_uri: `${base}/api/auth/callback`,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/authorize?${params}`);
}
