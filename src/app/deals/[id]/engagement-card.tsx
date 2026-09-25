"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeEngagementAction, searchInvestorCompanies, updateAgreedGroupsAction } from "./send/actions";

type Group = { companyId: string; name: string; status: number };
type Struck = { name: string; companyId: string | null; how: string; at: string; by: string | null };

/**
 * After the engagement letter goes out the sponsor comes back with redlines. Untick the groups they struck,
 * add any they asked for, then "Engagement letter signed": the agreed list becomes the progress report and
 * the deal moves to Engagement Letter Signed. The list stays editable after signing (Jonathan, Sep 16: the
 * sponsor crossed groups off after the letter was marked signed): untick or add, then "Save agreed groups".
 * Every group can be unticked, including one the deal already went to (Jonathan, Sep 16: having sent it before
 * does not mean he will not send it again, so nothing is greyed out).
 * The sponsor's emailed answer is read by the CRM (Jonathan, Sep 25, 2026): groups they erased from the quoted list,
 * crossed out or named come in as struck, start unticked and carry a tag saying what the sponsor did. Ticking one
 * puts it back (a group already taken off the report is added again on save).
 */
export function EngagementCard({ dealId, groups, struck = [], confirmed = null, signed }: { dealId: string; groups: Group[]; struck?: Struck[]; confirmed?: { at: string; by: string | null } | null; signed: boolean }) {
  const struckOf = (companyId: string) => struck.find((s) => s.companyId === companyId);
  const [keep, setKeep] = useState<Set<string>>(new Set(groups.filter((g) => !struckOf(g.companyId)).map((g) => g.companyId)));
  const [adds, setAdds] = useState<{ id: string; name: string }[]>([]);
  // struck groups already taken off the report still show, unticked; a tick adds them back
  const gone = struck.filter((s) => s.companyId && !groups.some((g) => g.companyId === s.companyId));
  const [back, setBack] = useState<Set<string>>(new Set());
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const tag = (s: Struck) => `${s.how} by ${s.by ?? "the sponsor"}, ${when(s.at)}`;
  const addIds = () => [...adds.map((a) => a.id), ...back];
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
          {keep.size + adds.length + back.size} of {groups.length + adds.length + gone.length}
        </span>
      </div>
      <div className="px-4 py-3 text-sm">
        <p className="mb-3 text-xs text-muted">{signed ? "Untick anything the sponsor struck, add anything they asked for, then save. The progress report follows the ticked groups." : "Untick anything the sponsor struck from the letter, add anything they asked for, then mark it signed. The ticked groups become the progress report."}</p>
        {(confirmed || struck.length > 0) && (
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {confirmed ? `${confirmed.by ?? "The sponsor"} confirmed the engagement by email on ${when(confirmed.at)}. ` : ""}
            {struck.length > 0 ? `${struck.length} group${struck.length === 1 ? "" : "s"} struck in their reply are unticked below (erased from the list, crossed out, or named). Tick one to put it back.` : ""}
          </p>
        )}
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
          {groups.map((g) => (
            <li key={g.companyId} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-ink"
                checked={keep.has(g.companyId)}
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
              {struckOf(g.companyId) && <span className="text-[10px] text-amber-700">{tag(struckOf(g.companyId)!)}</span>}
            </li>
          ))}
          {gone.map((s) => (
            <li key={`gone-${s.companyId}`} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-ink"
                checked={back.has(s.companyId!)}
                onChange={() =>
                  setBack((b) => {
                    const n = new Set(b);
                    if (n.has(s.companyId!)) n.delete(s.companyId!);
                    else n.add(s.companyId!);
                    return n;
                  })
                }
              />
              <span className={back.has(s.companyId!) ? "" : "line-through text-muted"}>{s.name}</span>
              <span className="text-[10px] text-amber-700">{tag(s)}</span>
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
        {(
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
        <div className="mt-4 flex items-center gap-3">
          {signed ? (
            <button
              type="button"
              className="btn-primary"
              disabled={pending || (keep.size === groups.length && adds.length === 0 && back.size === 0)}
              onClick={() =>
                start(async () => {
                  const r = await updateAgreedGroupsAction(dealId, [...keep], addIds());
                  setAdds([]);
                  setBack(new Set());
                  setDone(`Saved. ${r.agreed} groups on the progress report${r.removed ? `, ${r.removed} removed` : ""}${r.added ? `, ${r.added} added` : ""}.`);
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Save agreed groups"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await finalizeEngagementAction(dealId, [...keep], addIds());
                  setDone(`Signed. ${r.agreed} groups on the progress report${r.removed ? `, ${r.removed} removed` : ""}${r.added ? `, ${r.added} added` : ""}.`);
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Engagement letter signed"}
            </button>
          )}
          {done && <span className="text-xs text-muted">{done}</span>}
        </div>
      </div>
    </div>
  );
}
