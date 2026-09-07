import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Building2, Users, KanbanSquare, LayoutDashboard, Mail, FileText, Search, ClipboardList, Settings } from "lucide-react";
import { currentUser } from "@/lib/current-user";
import "./globals.css";
import { NavLink } from "@/components/nav-link";

export const metadata: Metadata = {
  title: "RJL CRM",
  description: "RJL Capital Advisors CRM",
};

const nav = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: KanbanSquare },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/investors", label: "Investor search", icon: Search },
  { href: "/reports", label: "Active progress reports", icon: ClipboardList },
  { href: "/campaigns", label: "Email blasts", icon: Mail },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-cream">
          <Link href="/" className="flex items-center px-5 pb-4 pt-6">
            <Image src="/logo.png" alt="RJL Capital Advisors" width={180} height={64} priority className="h-auto w-44" />
          </Link>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {nav.map((n) => (
              <NavLink key={n.href} href={n.href}>
                <n.icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            ))}
          </nav>
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
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
