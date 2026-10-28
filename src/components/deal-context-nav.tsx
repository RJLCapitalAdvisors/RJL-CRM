"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ClipboardList, FileText, ListChecks, Mail, Reply, ScrollText } from "lucide-react";
import { dealNavInfo, latestOutreachNavInfo } from "@/app/deal-nav-actions";

type Info = { id: string; name: string; stage: string };

/**
 * When you are inside a deal (its ticket, progress report, send page, investor search or engagement letter),
 * the sidebar shows that deal under "Deals" with its steps, so you can move between them without
 * losing your place. Reads the deal from the URL: /deals/<id>/... or ?dealId=<id>.
 *
 * Under "Investor search" the same block shows a reach out (Investor search > Reach out): the one open, else the latest
 * one, which stays there until a newer reach out starts (Jonathan, Oct 28, 2026: "I currently have no access to the
 * campaign I just sent out, and need to be able to at least go on it so that I could do follow ups").
 */
export function DealContextNav({ section = "deals" }: { section?: "deals" | "investors" } = {}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const fromPath = pathname.match(/^\/deals\/([^/]+)(?:\/(tracker|send|groups|followup|faq))?/) ?? pathname.match(/^\/investors\/reach\/([^/]+)/);
  const dealId = fromPath && !["new", "list"].includes(fromPath[1]) ? fromPath[1] : params.get("dealId");
  const [info, setInfo] = useState<Info | null>(null);
  const [latest, setLatest] = useState<Info | null>(null);

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

  // the latest reach out, read once per page under Investor search (and again when the path changes, so a new one shows at once)
  useEffect(() => {
    if (section !== "investors") return;
    let cancelled = false;
    latestOutreachNavInfo().then((r) => {
      if (!cancelled) setLatest(r);
    });
    return () => {
      cancelled = true;
    };
  }, [section, pathname]);

  const current = dealId && info?.id === dealId ? info : null;
  const outreachOpen = current?.stage === "Outreach";
  // Deals: the deal open (never a reach out). Investor search: the reach out open, else the latest reach out.
  const shown: Info | null = section === "deals" ? (current && !outreachOpen ? current : null) : outreachOpen ? current : latest;
  if (!shown) return null;
  const id = shown.id;
  const outreach = shown.stage === "Outreach";
  // the order of the work: ticket, engagement letter (which includes finding the investors), send, then the progress report
  const steps = outreach
    ? [
        { href: `/investors/reach/${id}/send`, label: "Send outreach", icon: Mail, on: pathname.endsWith(`/${id}/send`) },
        { href: `/investors/reach/${id}/followup`, label: "Follow ups", icon: Reply, on: pathname.endsWith(`/${id}/followup`) },
      ]
    : [
        { href: `/deals/${id}`, label: "Ticket", icon: ClipboardList, on: pathname === `/deals/${id}` },
        { href: `/investors?dealId=${id}&mode=engagement`, label: "Engagement letter", icon: ScrollText, on: pathname === "/investors" },
        { href: `/deals/${id}/groups`, label: "Agreed groups", icon: ListChecks, on: pathname === `/deals/${id}/groups` },
        { href: `/deals/${id}/send`, label: "Send deal", icon: Mail, on: pathname === `/deals/${id}/send` },
        { href: `/deals/${id}/tracker`, label: "Progress report", icon: FileText, on: pathname === `/deals/${id}/tracker` },
        { href: `/deals/${id}/followup`, label: "Follow ups", icon: Reply, on: pathname === `/deals/${id}/followup` },
      ];
  return (
    <div className="ml-3 mt-0.5 mb-1 border-l-2 border-sky-600 pl-2">
      <div className="truncate px-1 pb-1 text-xs font-semibold" title={shown.name}>
        {shown.name}
      </div>
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted">{outreach ? (outreachOpen ? "Reach out" : "Latest reach out") : shown.stage}</div>
      {steps.map((s) => (
        <Link key={s.label} href={s.href} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${s.on ? "bg-sky text-ink font-medium" : "text-ink-soft hover:bg-sky/40"}`}>
          <s.icon className="h-3.5 w-3.5" />
          {s.label}
        </Link>
      ))}
    </div>
  );
}
