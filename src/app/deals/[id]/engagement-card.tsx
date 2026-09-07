"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeEngagementAction, searchInvestorCompanies } from "./send/actions";

type Group = { companyId: string; name: string; status: number };

/**
 * After the engagement letter goes out the sponsor comes back with redlines. Untick the groups they struck,
 * add any they asked for, then "Engagement letter signed": the agreed list becomes the progress report and
 * the deal moves to Engagement Letter Signed.
 */
export function EngagementCard({ dealId, groups, signed }: { dealId: string; groups: Group[]; signed: boolean }) {
  const [keep, setKeep] = useState<Set<string>>(new Set(groups.map((g) => g.companyId)));
  const [adds, setAdds] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<{ id: string; name: string }[]>([]);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) return setOpts([]);
    timer.current = setTimeout(() => searchInvestorCompanies(v).then((r) => setOpts(r.filter((o) => !groups.some((g) => g.companyId === o.id) && !adds.some((a) => a.id === o.id)))), 200);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-3">
        <h2 className="text-sm font-semibold">{signed ? "Agreed groups" : "Engagement letter out: finalize the agreed groups"}</h2>
        <span className="text-xs text-muted">
          {keep.size + adds.length} of {groups.length + adds.length}
        </span>
      </div>
      <div className="px-4 py-3 text-sm">
        {!signed && <p className="mb-3 text-xs text-muted">Untick anything the sponsor struck from the letter, add anything they asked for, then mark it signed. The ticked groups become the progress report.</p>}
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
          {groups.map((g) => (
            <li key={g.companyId} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-ink"
                checked={keep.has(g.companyId)}
                disabled={signed || g.status > 1}
                onChange={() =>
                  setKeep((s) => {
                    const n = new Set(s);
                    if (n.has(g.companyId)) n.delete(g.companyId);
                    else n.add(g.companyId);
                    return n;
                  })
                }
              />
              <span className={keep.has(g.companyId) ? "" : "line-through text-muted"}>{g.name}</span>
              {g.status > 1 && <span className="text-[10px] text-muted">already sent</span>}
            </li>
          ))}
          {adds.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <input type="checkbox" className="accent-ink" checked readOnly onChange={() => setAdds((s) => s.filter((x) => x.id !== a.id))} />
              <span>{a.name}</span>
              <span className="text-[10px] text-sky-600">added</span>
            </li>
          ))}
        </ul>
        {!signed && (
          <div className="relative mt-3 max-w-sm">
            <input value={q} onChange={(e) => search(e.target.value)} placeholder="Add a group the sponsor asked for…" className="input text-sm" />
            {opts.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-paper shadow-lg">
                {opts.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-cream"
                      onClick={() => {
                        setAdds((s) => [...s, o]);
                        setQ("");
                        setOpts([]);
                      }}
                    >
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!signed && (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await finalizeEngagementAction(dealId, [...keep], adds.map((a) => a.id));
                  setDone(`Signed. ${r.agreed} groups on the progress report${r.removed ? `, ${r.removed} removed` : ""}${r.added ? `, ${r.added} added` : ""}.`);
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Engagement letter signed"}
            </button>
            {done && <span className="text-xs text-muted">{done}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
