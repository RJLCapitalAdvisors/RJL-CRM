"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { fmtUsd } from "@/lib/format";
import { isAcquisitionsPath, isIsraelPath } from "@/lib/workspace";
import type { Meter } from "@/lib/claude-usage";

/**
 * The Claude cost meter at the bottom of the sidebar and the out-of-credits banner at the top of the app
 * (Nov 12, 2026). Both read /api/claude-usage: when a page opens, when the window gets the focus back and once a
 * minute while it is in view, so the numbers move soon after a click that used Claude. One reading feeds both.
 */
let meter: Meter | null = null;
let asked = 0;
const listeners = new Set<() => void>();

async function refresh() {
  if (Date.now() - asked < 5000) return;
  asked = Date.now();
  try {
    const res = await fetch("/api/claude-usage", { cache: "no-store" });
    if (!res.ok) return;
    meter = (await res.json()) as Meter | null;
    listeners.forEach((tell) => tell());
  } catch {
    // offline or signed out: keep showing the last reading
  }
}

const subscribe = (tell: () => void) => {
  listeners.add(tell);
  return () => void listeners.delete(tell);
};

/** Pages shown to people outside the team (a sponsor's report link, the submission forms, sign-in): no meter, no banner, nothing asked. */
const outside = (pathname: string) => ["/share", "/submit", "/login", "/unsubscribe"].some((p) => pathname === p || pathname.startsWith(p + "/"));

function useMeter(): Meter | null {
  const value = useSyncExternalStore(subscribe, () => meter, () => null);
  const pathname = usePathname();
  const off = outside(pathname);
  useEffect(() => {
    if (!off) void refresh();
  }, [pathname, off]);
  useEffect(() => {
    if (off) return;
    const again = () => document.visibilityState === "visible" && void refresh();
    const timer = setInterval(again, 60_000);
    window.addEventListener("focus", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, [off]);
  return off ? null : value;
}

/** Settings > Claude usage on the side the person is in. */
const usagePage = (pathname: string) => (isIsraelPath(pathname) ? "/israel/settings/claude-usage" : isAcquisitionsPath(pathname) ? "/acquisitions/settings/claude-usage" : "/settings/claude-usage");

export function ClaudeMeter() {
  const m = useMeter();
  const pathname = usePathname();
  if (outside(pathname)) return null;
  return (
    <Link href={usagePage(pathname)} title="Open Claude usage" className="block border-t border-line px-5 py-2.5 text-xs text-ink-soft hover:bg-sky/40">
      <span className="text-sky-600">✦</span> Claude: {m ? `${fmtUsd(m.today)} today, ${fmtUsd(m.month)} this month` : "…"}
    </Link>
  );
}

export function ClaudeCreditBanner() {
  const m = useMeter();
  const pathname = usePathname();
  if (!m?.outOfCredits) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-red-700 px-6 py-2 text-sm font-medium text-white">
      <span>Claude is out of credits. Everything marked ✦ will fail until credits are added in the Anthropic Console, under Billing.</span>
      <Link href={usagePage(pathname)} className="underline underline-offset-2">
        Claude usage
      </Link>
    </div>
  );
}
