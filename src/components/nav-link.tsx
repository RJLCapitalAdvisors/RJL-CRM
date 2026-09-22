"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, exact = false, except = [] }: { href: string; children: React.ReactNode; exact?: boolean; except?: string[] }) {
  const pathname = usePathname();
  const active = (href === "/" || exact ? pathname === href : pathname.startsWith(href)) && !except.some((x) => pathname.startsWith(x));
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-ink text-paper" : "text-ink hover:bg-sky/40"
      }`}
    >
      {children}
    </Link>
  );
}
