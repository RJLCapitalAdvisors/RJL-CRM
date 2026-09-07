import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";
import { COOKIE } from "@/proxy";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(COOKIE);
  return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? req.nextUrl.origin));
}
