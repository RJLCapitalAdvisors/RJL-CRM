"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ClipboardList, FileText, Mail, ScrollText } from "lucide-react";
import { dealNavInfo } from "@/app/deal-nav-actions";

/**
 * When you are inside a deal (its ticket, progress report, send page, investor search or engagement letter),
 * the sidebar shows that deal under "Deals" with its steps, so you can move between them without
 * losing your place. Reads the deal from the URL: /deals/<id>/... or ?dealId=<id>.
 */
export function DealContextNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const fromPath = pathname.match(/^\/deals\/([^/]+)(?:\/(tracker|send))?/);
  const dealId = fromPath && !["new", "list"].includes(fromPath[1]) ? fromPath[1] : params.get("dealId");
  const [info, setInfo] = useState<{ id: string; name: string; stage: string } | null>(null);

  useEffect(() => {
    if (!dealId) return;
    if (info?.id === dealId) return;
    let cancelled = false;
    dealNavInfo(dealId).then((r) => {
      if (!cancelled) setInfo(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  if (!dealId || !info || info.id !== dealId) return null;
  // the order of the work: ticket, engagement letter (which includes finding the investors), send, then the progress report
  const steps = [
    { href: `/deals/${dealId}`, label: "Ticket", icon: ClipboardList, on: pathname === `/deals/${dealId}` },
    { href: `/investors?dealId=${dealId}&mode=engagement`, label: "Engagement letter", icon: ScrollText, on: pathname === "/investors" },
    { href: `/deals/${dealId}/send`, label: "Send deal", icon: Mail, on: pathname === `/deals/${dealId}/send` },
    { href: `/deals/${dealId}/tracker`, label: "Progress report", icon: FileText, on: pathname === `/deals/${dealId}/tracker` },
  ];
  return (
    <div className="ml-3 mt-0.5 mb-1 border-l-2 border-sky-600 pl-2">
      <div className="truncate px-1 pb-1 text-xs font-semibold" title={info.name}>
        {info.name}
      </div>
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted">{info.stage}</div>
      {steps.map((s) => (
        <Link key={s.label} href={s.href} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${s.on ? "bg-sky text-ink font-medium" : "text-ink-soft hover:bg-sky/40"}`}>
          <s.icon className="h-3.5 w-3.5" />
          {s.label}
        </Link>
      ))}
    </div>
  );
}
