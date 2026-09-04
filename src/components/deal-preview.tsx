"use client";

import { useEffect, useMemo, useState } from "react";
import { renderTemplate, toHtml, type MergeContext } from "@/lib/merge";

type Tpl = { id: string; name: string; subject: string; bodyHtml: string };
const NUMERIC = new Set(["requestedAmount", "totalEquity", "totalDebt", "totalCapitalization", "purchasePrice", "ltv", "ltc", "equityMultiple", "irr", "yieldOnCost", "capRateY1", "capRateT12", "cashOnCash", "occupancy", "units", "squareFeet"]);

/** Live rendering of a deal email template from whatever is currently typed in #deal-form. */
/** Best-guess template for a deal: multifamily vs not, development vs existing, JV vs pref vs debt. */
function pickDefault(templates: Tpl[], deal: Record<string, unknown>): string {
  const ac = String(deal.assetClass ?? "");
  const mf = ["Multifamily", "Build-For-Rent (SFR)", "Student Housing", "Senior Housing"].includes(ac);
  const dev = deal.strategy === "Development";
  const exec = String(deal.executionType ?? "");
  const debt = deal.requestType === "Debt" || /Debt/.test(exec);
  const pref = /Pref/.test(exec);
  const score = (t: Tpl) => {
    const n = t.name.toLowerCase();
    if (n.includes("house style")) return 100;
    let s = 0;
    if (debt) return n.includes("debt") ? 10 : 0;
    if (n.includes("fund") || n.includes("engagement") || n.includes("shopping") || n.includes("follow-up") || n.includes("legacy") || n.includes("blast")) return -1;
    if (n.includes("non-multifamily") === !mf) s += 4;
    if (n.includes("development") === dev) s += 3;
    if (pref ? n.includes("pref") : n.includes("jv")) s += 2;
    return s;
  };
  return [...templates].sort((a, b) => score(b) - score(a))[0]?.id ?? "";
}

export function DealPreview({ templates, initial, senderName }: { templates: Tpl[]; initial: Record<string, unknown>; senderName: string }) {
  const [tplId, setTplId] = useState(() => pickDefault(templates, initial));
  const [deal, setDeal] = useState<Record<string, unknown>>(initial);

  useEffect(() => {
    const form = document.getElementById("deal-form") as HTMLFormElement | null;
    if (!form) return;
    const read = () => {
      const fd = new FormData(form);
      const next: Record<string, unknown> = { ...initial };
      const details: Record<string, string | null> = { ...((initial.details && typeof initial.details === "object" ? (initial.details as Record<string, string | null>) : {}) ?? {}) };
      fd.forEach((val, key) => {
        if (typeof val !== "string") return;
        const v = val.trim();
        if (key.startsWith("detail.")) {
          details[key.slice(7)] = v || null;
          return;
        }
        if (NUMERIC.has(key)) {
          const n = Number(v.replace(/[^0-9.-]/g, ""));
          next[key] = v && !isNaN(n) ? n : null;
        } else if (key === "onMarket") next[key] = v === "on" ? true : v === "off" ? false : null;
        else next[key] = v || null;
      });
      next.details = details;
      if (typeof next.totalCapitalization === "number" && typeof next.totalDebt === "number") next.totalEquity = next.totalCapitalization - next.totalDebt;
      setDeal(next);
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, [initial]);

  const tpl = templates.find((t) => t.id === tplId);
  const ctx: MergeContext = useMemo(
    () => ({ contact: { firstName: "Investor", lastName: "", email: "" }, company: { name: "the firm" }, deal, sender: { name: senderName }, unsubscribeUrl: "#", openingLine: null }),
    [deal, senderName]
  );

  if (!tpl) return <div className="p-5 text-sm text-muted">No deal templates yet.</div>;
  const subject = renderTemplate(tpl.subject, ctx);
  const html = toHtml(renderTemplate(tpl.bodyHtml, ctx));
  return (
    <div>
      <div className="space-y-2 border-b border-line px-4 py-3">
        <h2 className="font-semibold">Email preview</h2>
        <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="input text-xs">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="p-4">
        <div className="mb-3 text-sm font-semibold">{subject}</div>
        <div className="rounded-md border border-line bg-paper p-4 text-[13px] leading-relaxed [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="mt-2 text-[11px] text-muted">Updates as you type. Blank spots are fields not filled in yet.</div>
      </div>
    </div>
  );
}
