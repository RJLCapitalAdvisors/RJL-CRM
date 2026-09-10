"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Building2, Users, KanbanSquare, LayoutDashboard, Mail, FileText, Search, ClipboardList, Settings, MessageSquare } from "lucide-react";
import { NavLink } from "@/components/nav-link";
import { DealContextNav } from "@/components/deal-context-nav";
import { ApartmentContextNav } from "@/components/apartment-context-nav";
import { isIsraelPath } from "@/lib/workspace";

const CA_NAV = [
  { href: "/ask", label: "Ask the CRM", icon: MessageSquare },
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: KanbanSquare },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/investors", label: "Investor search", icon: Search },
  { href: "/reports", label: "Active progress reports", icon: ClipboardList },
  { href: "/campaigns", label: "Email blasts", icon: Mail },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

const IL_NAV = [
  { href: "/israel/ask", label: "Ask the CRM", icon: MessageSquare },
  { href: "/israel", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/israel/projects", label: "Projects", icon: Building2 },
  { href: "/israel/apartments", label: "Apartments", icon: Building2 },
  { href: "/israel/companies", label: "Companies", icon: Building2 },
  { href: "/israel/contacts", label: "Contacts", icon: Users },
  { href: "/israel/deals", label: "Deals", icon: KanbanSquare },
];

/**
 * One sidebar for both businesses. The two logos always sit side by side at the top; the one you are in is
 * highlighted and its pages are listed underneath. The body carries the `israel` class while you are in
 * RJL Israel so the accent turns royal blue.
 */
export function WorkspaceSidebar({ user }: { user: { name: string; workspaces?: string[]; accounts?: Partial<Record<"CA" | "IL", string>> } | null }) {
  // both logos always sit at the top. A side is faded until you sign in with the account for it (an
  // @rjlcapadvisors.com account for RJL Capital Advisors, an @rjlisrael.com account for RJL Israel); clicking a
  // faded tile starts that sign-in. Someone with both signs in twice. The team password opens both.
  const ws = user ? user.workspaces ?? [] : ["CA", "IL"];
  const openCA = ws.includes("CA"), openIL = ws.includes("IL");
  const pathname = usePathname();
  const israel = isIsraelPath(pathname);
  useEffect(() => {
    document.body.classList.toggle("israel", israel);
  }, [israel]);

  const tile = (active: boolean, open: boolean) => `flex h-14 items-center justify-center rounded-lg border px-2 transition ${!open ? "border-dashed border-line opacity-35 grayscale hover:opacity-60" : active ? "border-sky-600 shadow-sm ring-2 ring-sky/40" : "border-line opacity-60 hover:opacity-100"}`;
  const signIn = (b: "CA" | "IL", next: string) => `/login?business=${b}&next=${encodeURIComponent(next)}`;
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-cream">
      <div className="grid grid-cols-2 gap-2 px-3 pt-4">
        <a href={openCA ? "/" : signIn("CA", "/")} aria-current={!israel && openCA ? "page" : undefined} title={openCA ? "RJL Capital Advisors" : "Sign in with your @rjlcapadvisors.com account to open RJL Capital Advisors"} className={`${tile(!israel, openCA)} bg-white`}>
          <Image src="/logo.png" alt="RJL Capital Advisors" width={180} height={64} priority className="h-auto w-full" />
        </a>
        <a href={openIL ? "/israel" : signIn("IL", "/israel")} aria-current={israel && openIL ? "page" : undefined} title={openIL ? "RJL Israel" : "Sign in with your @rjlisrael.com account to open RJL Israel"} className={`${tile(israel, openIL)} bg-[#161b21]`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/israel-logo.svg" alt="RJL Israel" className="h-auto w-full" />
        </a>
      </div>
      {user && !(openCA && openIL) && <div className="px-4 pt-2 text-[11px] leading-snug text-muted">{openCA ? "RJL Israel is faded until you sign in with your @rjlisrael.com account. Click its logo." : "RJL Capital Advisors is faded until you sign in with your @rjlcapadvisors.com account. Click its logo."}</div>}
      <div className="px-3 pt-3">{israel ? <Nav items={IL_NAV} apartmentSteps /> : <Nav items={CA_NAV} dealSteps />}</div>
      <div className="flex-1" />
      <div className="px-5 py-4 text-xs text-muted">
        {user ? (
          <>
            <div className="font-medium text-ink">{user.name}</div>
            {user.accounts?.CA && <div className="truncate" title={user.accounts.CA}>{user.accounts.CA}</div>}
            {user.accounts?.IL && <div className="truncate" title={user.accounts.IL}>{user.accounts.IL}</div>}
            <a href="/api/auth/logout" className="hover:underline">
              Sign out
            </a>
          </>
        ) : (
          <a href="/login" className="hover:underline">
            Sign in with Microsoft
          </a>
        )}
      </div>
    </aside>
  );
}

function Nav({ items, dealSteps = false, apartmentSteps = false }: { items: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }[]; dealSteps?: boolean; apartmentSteps?: boolean }) {
  return (
    <nav className="flex flex-col gap-1 pb-2">
      {items.map((n) => (
        <div key={n.href}>
          <NavLink href={n.href} exact={n.exact}>
            <n.icon className="h-4 w-4" />
            {n.label}
          </NavLink>
          {dealSteps && n.href === "/deals" && (
            <Suspense fallback={null}>
              <DealContextNav />
            </Suspense>
          )}
          {apartmentSteps && n.href === "/israel/apartments" && (
            <Suspense fallback={null}>
              <ApartmentContextNav />
            </Suspense>
          )}
        </div>
      ))}
    </nav>
  );
}
