"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type AudienceItem = {
  id: string;
  name: string;
  email: string;
  companyName: string | null;
  companyId: string | null;
  score: number;
  possible: number;
  reasons: string[];
  misses: string[];
  criteriaSource: "contact" | "company" | "none";
};

export function AudienceTable({ rows, minScore, templateChosen }: { rows: AudienceItem[]; minScore: number; templateChosen: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((r) => r.score >= minScore).map((r) => r.id)));
  const [filter, setFilter] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => (!onlySelected || selected.has(r.id)) && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (r.companyName ?? "").toLowerCase().includes(q)));
  }, [rows, filter, onlySelected, selected]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function setAllVisible(on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const r of visible) if (on) n.add(r.id);
      else n.delete(r.id);
      return n;
    });
  }
  function selectScoreAtLeast(n: number) {
    setSelected(new Set(rows.filter((r) => r.score >= n).map((r) => r.id)));
  }

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const r of rows) c[r.score] = (c[r.score] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="text-sm">
          <span className="font-semibold">{selected.size.toLocaleString()}</span> of {rows.length.toLocaleString()} eligible contacts selected
          <span className="ml-3 text-xs text-muted">
            by score:{" "}
            {Object.keys(counts)
              .map(Number)
              .sort((a, b) => b - a)
              .map((k) => (
                <button key={k} type="button" className="mr-2 underline decoration-dotted hover:text-ink" onClick={() => selectScoreAtLeast(k)} title={`Select everyone scoring ${k} or more`}>
                  {k}+ ({rows.filter((r) => r.score >= k).length})
                </button>
              ))}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter list…" className="input w-56" />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} className="accent-ink" /> Selected only
          </label>
          <button type="button" className="btn-secondary" onClick={() => setAllVisible(true)}>
            Select shown
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAllVisible(false)}>
            Clear shown
          </button>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>Contact</th>
              <th>Company</th>
              <th className="text-center">Score</th>
              <th>Why it fits</th>
              <th>Gaps</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "" : "opacity-60"}>
                <td>
                  <input type="checkbox" name="contactId" value={r.id} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-ink" />
                </td>
                <td>
                  <Link href={`/contacts/${r.id}`} className="font-medium hover:underline" target="_blank">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted">{r.email}</div>
                </td>
                <td>
                  {r.companyId ? (
                    <Link href={`/companies/${r.companyId}`} className="hover:underline" target="_blank">
                      {r.companyName}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  {r.criteriaSource === "none" && <div className="text-[11px] text-amber-700">no criteria</div>}
                </td>
                <td className="text-center">
                  <span className={`chip ${r.score > 0 ? "bg-sky text-ink" : "bg-stone-100 text-muted"}`}>
                    {r.score}
                    {r.possible ? `/${r.possible}` : ""}
                  </span>
                </td>
                <td className="text-xs">{r.reasons.join(" · ")}</td>
                <td className="text-xs text-muted">{r.misses.join(", ")}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  No contacts match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        <div className="text-xs text-muted">Unsubscribed, hard-bounced, and no-email contacts are excluded automatically.</div>
        <button className="btn-primary" type="submit" disabled={!templateChosen || selected.size === 0} title={!templateChosen ? "Choose a template above and click Build list" : ""}>
          Create campaign with {selected.size.toLocaleString()} recipient{selected.size === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
