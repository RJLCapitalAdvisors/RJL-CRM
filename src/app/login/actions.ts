"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { COOKIE, sessionToken } from "@/proxy";

export async function login(fd: FormData) {
  const given = String(fd.get("password") ?? "");
  const next = String(fd.get("next") ?? "/");
  const expected = process.env.APP_PASSWORD ?? "";
  const a = Buffer.from(given), b = Buffer.from(expected);
  const ok = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!ok) redirect(`/login?error=1${next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  const jar = await cookies();
  jar.set(COOKIE, await sessionToken(expected, process.env.APP_SECRET ?? "dev-secret"), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(next.startsWith("/") ? next : "/");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
  redirect("/login");
}
