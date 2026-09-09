"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Building2, Users, KanbanSquare, LayoutDashboard, Mail, FileText, Search, ClipboardList, Settings, MessageSquare } from "lucide-react";
import { NavLink } from "@/components/nav-link";
import { DealContextNav } from "@/components/deal-context-nav";
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
  { href: "/israel", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/israel/apartments", label: "Apartments", icon: KanbanSquare },
  { href: "/israel/companies", label: "Companies", icon: Building2 },
  { href: "/israel/contacts", label: "Contacts", icon: Users },
  { href: "/israel/deals", label: "Deals", icon: KanbanSquare },
];


/**
 * One sidebar for both businesses. The two logos sit at the top; the one you are in is open with its pages
 * listed underneath, the other is a button that takes you across. The body carries the `israel` class while
 * you are in RJL Israel so the whole page, sidebar included, goes dark.
 */
export function WorkspaceSidebar({ user }: { user: { name: string } | null }) {
  const pathname = usePathname();
  const israel = isIsraelPath(pathname);
  useEffect(() => {
    document.body.classList.toggle("israel", israel);
  }, [israel]);

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-cream">
      <div className="flex flex-col gap-2 px-3 pt-4">
        <Link
          href="/"
          aria-current={!israel ? "page" : undefined}
          title="RJL Capital Advisors"
          className={`block rounded-lg border bg-white px-4 transition ${!israel ? "border-line py-3 shadow-sm" : "border-transparent py-2 opacity-70 hover:opacity-100"}`}
        >
          <Image src="/logo.png" alt="RJL Capital Advisors" width={180} height={64} priority className={`h-auto ${!israel ? "w-44" : "w-32"}`} />
        </Link>
        {!israel && <Nav items={CA_NAV} dealSteps />}
        <Link
          href="/israel"
          aria-current={israel ? "page" : undefined}
          title="RJL Israel"
          className={`block rounded-lg border bg-white px-4 transition ${israel ? "border-line py-3 shadow-sm" : "border-transparent py-2 opacity-70 hover:opacity-100"}`}
        >
          <Image src="/israel-logo.png?v=3" alt="RJL Israel" width={180} height={64} priority className={`h-auto ${israel ? "w-44" : "w-32"}`} />
        </Link>
        {israel && <Nav items={IL_NAV} />}
      </div>
      <div className="flex-1" />
      <div className="px-5 py-4 text-xs text-muted">
        {user ? (
          <>
            <div className="font-medium text-ink">{user.name}</div>
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

function Nav({ items, dealSteps = false }: { items: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }[]; dealSteps?: boolean }) {
  return (
    <nav className="flex flex-col gap-1 pb-2 pt-1">
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
        </div>
      ))}
    </nav>
  );
}
