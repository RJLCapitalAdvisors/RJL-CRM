import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Building2, Users, KanbanSquare, LayoutDashboard, Mail, FileText, Sparkles } from "lucide-react";
import "./globals.css";
import { NavLink } from "@/components/nav-link";

export const metadata: Metadata = {
  title: "RJL CRM",
  description: "RJL Capital Advisors CRM",
};

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: KanbanSquare },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
];

const soon = [
  { label: "Campaigns", icon: Mail },
  { label: "Templates", icon: FileText },
  { label: "Criteria Proposals", icon: Sparkles },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
            <div className="mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Coming next</div>
            {soon.map((n) => (
              <div key={n.label} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted">
                <n.icon className="h-4 w-4" />
                {n.label}
              </div>
            ))}
          </nav>
          <div className="px-5 py-4 text-xs text-muted">RJL Capital Advisors</div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
