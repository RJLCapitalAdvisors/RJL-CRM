import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Users, KanbanSquare, LayoutDashboard, Search, ArrowLeftRight } from "lucide-react";
import { NavLink } from "@/components/nav-link";
import { currentUser } from "@/lib/current-user";

export const metadata: Metadata = {
  title: { default: "RJL Israel", template: "%s · RJL Israel" },
  description: "RJL Israel CRM",
};

const nav = [
  { href: "/israel", label: "Dashboard", icon: LayoutDashboard },
  { href: "/israel/apartments", label: "Apartments", icon: KanbanSquare },
  { href: "/israel/companies", label: "Companies", icon: Building2 },
  { href: "/israel/contacts", label: "Contacts", icon: Users },
  { href: "/israel/search", label: "Apartment search", icon: Search },
];

/** RJL Israel: the same shape as RJL Capital Advisors, in black. The root layout leaves this section to its own sidebar. */
export default async function IsraelLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <div className="israel flex min-h-screen w-full bg-[#0c0e11] text-ink">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-[#0c0e11]">
        <Link href="/israel" className="flex items-center gap-3 px-5 pb-4 pt-6">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-white/10 text-lg text-sky">✦</span>
          <span className="leading-tight">
            <span className="block text-lg font-semibold tracking-wide text-white">RJL</span>
            <span className="block text-[11px] uppercase tracking-[0.25em] text-sky">Israel</span>
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.href === "/israel"}>
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-2">
          <Link href="/start" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-white">
            <ArrowLeftRight className="h-4 w-4" /> Switch to RJL Capital Advisors
          </Link>
        </div>
        <div className="px-5 py-4 text-xs text-muted">
          {user ? (
            <>
              <div className="font-medium text-white">{user.name}</div>
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
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
