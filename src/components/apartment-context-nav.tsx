"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ClipboardList, Columns3 } from "lucide-react";
import { apartmentNavInfo } from "@/app/israel/apartment-nav-actions";

/**
 * Inside an apartment (its ticket) or the comparison, the sidebar shows where you are under "Apartments",
 * the way a deal shows its steps under "Deals" in RJL Capital Advisors.
 */
export function ApartmentContextNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const m = pathname.match(/^\/israel\/apartments\/([^/]+)$/);
  const aptId = m && !["new", "compare"].includes(m[1]) ? m[1] : null;
  const comparing = pathname === "/israel/apartments/compare";
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const [info, setInfo] = useState<{ id: string; name: string; line: string } | null>(null);

  useEffect(() => {
    if (!aptId || info?.id === aptId) return;
    let cancelled = false;
    apartmentNavInfo(aptId).then((r) => {
      if (!cancelled) setInfo(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aptId]);

  if (comparing) {
    return (
      <div className="ml-3 mt-0.5 mb-1 border-l-2 border-sky-600 pl-2">
        <Link href={pathname + (ids.length ? `?ids=${ids.join(",")}` : "")} className="flex items-center gap-2 rounded bg-sky px-2 py-1 text-xs font-medium text-ink">
          <Columns3 className="h-3.5 w-3.5" />
          Compare units{ids.length ? ` (${ids.length})` : ""}
        </Link>
      </div>
    );
  }
  if (!aptId || !info || info.id !== aptId) return null;
  return (
    <div className="ml-3 mt-0.5 mb-1 border-l-2 border-sky-600 pl-2">
      <div className="truncate px-1 pb-1 text-xs font-semibold" title={info.name}>
        {info.name}
      </div>
      {info.line && <div className="truncate px-1 pb-1 text-[10px] text-muted">{info.line}</div>}
      <Link href={`/israel/apartments/${aptId}`} className="flex items-center gap-2 rounded bg-sky px-2 py-1 text-xs font-medium text-ink">
        <ClipboardList className="h-3.5 w-3.5" />
        Ticket
      </Link>
    </div>
  );
}
