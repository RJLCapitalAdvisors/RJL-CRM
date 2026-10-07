"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileUp, MessageSquare } from "lucide-react";

const TABS = [
  { href: "/acquisitions/ask", label: "Ask", hint: "Questions and instructions", icon: MessageSquare, match: (p: string) => !p.startsWith("/acquisitions/ask/import") },
  { href: "/acquisitions/ask/import", label: "Import", hint: "Load a call export", icon: FileUp, match: (p: string) => p.startsWith("/acquisitions/ask/import") },
];

/** Ask the CRM's sections (Shawn, Oct 7, 2026): the chat for questions and instructions, and the Import section for files. */
export function AskTabs() {
  const path = usePathname() ?? "";
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line bg-paper px-4">
      {TABS.map((t) => {
        const on = t.match(path);
        return (
          <Link key={t.href} href={t.href} title={t.hint} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] ${on ? "border-sky-700 font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
