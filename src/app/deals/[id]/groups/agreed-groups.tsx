"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeEngagementAction, searchInvestorCompanies } from "../send/actions";
import { createEngagementLetter } from "@/app/investors/actions";
import { DraftButton } from "@/app/draft-button";
import { addGroupAction, tickGroupAction } from "./actions";

type Group = { companyId: string; name: string; status: number };
type Struck = { name: string; companyId: string | null; how: string; at: string; by: string | null };

/**
 * The Agreed groups page: the step between the engagement letter and sending the deal (Jonathan, Sep 28, 2026).
 * Every group on the letter is listed, ticked when agreed. Groups the sponsor erased, crossed out or named in their
 * emailed answer come in unticked and greyed, tagged with what the sponsor did and when; a group Jonathan unticks
 * himself stays on the list the same way. Each tick saves as it happens. Before the letter is signed the ticks only
 * mark the list; "Engagement letter signed" turns the ticked groups into the progress report and moves the deal on.
 * After that the report follows every tick straight away. Nothing is greyed out for having been sent already
 * (Jonathan, Sep 16: he may send it again).
 * "Draft engagement letter" drafts the letter from here with the ticked groups (Jonathan, Oct 7, 2026: on Indicap
 * he wanted to put back two groups the sponsor had crossed off and send the letter again without going through the
 * investor search). The draft opens in Outlook like the one from the search; the earlier letter's sent and confirmed
 * marks are forgotten so the new send is watched afresh.
 */
export function AgreedGroups({ dealId, groups, struck, confirmed, signed }: { dealId: string; groups: Group[]; struck: Struck[]; confirmed: { at: string; by: string | null } | null; signed: boolean }) {
  const struckOf = (companyId: string) => struck.find((s) => s.companyId === companyId);
  // the whole list: the groups on the deal, then struck groups already taken off the report
  const all: { companyId: string; name: string; struck?: Struck }[] = [
    ...groups.map((g) => ({ companyId: g.companyId, name: g.name, struck: struckOf(g.companyId) })),
    ...struck.filter((s) => s.companyId && !groups.some((g) => g.companyId === s.companyId)).map((s) => ({ companyId: s.companyId!, name: s.name, struck: s })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const [ticked, setTicked] = useState<Set<string>>(new Set(all.filter((g) => !g.struck).map((g) => g.companyId)));
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<{ id: string; name: string }[]>([]);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const tag = (s: Struck) => `${s.how} by ${s.by ?? "the sponsor"}, ${when(s.at)}`;

  const toggle = (companyId: string) => {
    const on = !ticked.has(companyId);
    setTicked((s) => {
      const n = new Set(s);
      if (on) n.add(companyId);
      else n.delete(companyId);
      return n;
    });
    setSaving("saving");
    tickGroupAction(dealId, companyId, on)
      .then(() => {
        setSaving("saved");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaving("idle"), 2000);
        router.refresh();
      })
      .catch(() => setSaving("idle"));
  };

  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) return setOpts([]);
    timer.current = setTimeout(() => searchInvestorCompanies(v).then((r) => setOpts(r.filter((o) => !all.some((g) => g.companyId === o.id)))), 200);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const sponsorStruck = struck.filter((s) => s.how !== "unticked");

  return (
    <div className="mx-auto max-w-4xl px-6 py-4">
      {(confirmed || sponsorStruck.length > 0) && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {confirmed ? `${confirmed.by ?? "The sponsor"} confirmed the engagement by email on ${when(confirmed.at)}. ` : ""}
          {sponsorStruck.length > 0 ? `${sponsorStruck.length} group${sponsorStruck.length === 1 ? "" : "s"} struck in their reply are greyed out below (erased from the list, crossed out, or named). Tick one to put it back.` : ""}
        </p>
      )}
      <div className="card">
        <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-3">
          <h2 className="text-sm font-semibold">{signed ? "Agreed groups" : "Groups on the engagement letter"}</h2>
          <span className="text-xs text-muted">
            {ticked.size} of {all.length} agreed{saving === "saving" ? " · saving…" : saving === "saved" ? " · saved" : ""}
          </span>
        </div>
        <div className="px-4 py-3 text-sm">
          <p className="mb-3 text-xs text-muted">{signed ? "Every tick saves as you go and the progress report follows it. Untick anything the sponsor struck, tick a group back to put it on the report again, add anything they asked for." : "Every tick saves as you go. Untick anything the sponsor struck from the letter, add anything they asked for, then mark the letter signed: the ticked groups become the progress report. Draft engagement letter writes the letter again with the ticked groups, for when you put a struck group back."}</p>
          {all.length === 0 && <p className="text-sm text-muted">No groups yet. Generate the engagement letter first: the groups you pick there land here.</p>}
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
            {all.map((g) => (
              <li key={g.companyId} className="flex items-center gap-2">
                <input type="checkbox" className="accent-ink" checked={ticked.has(g.companyId)} onChange={() => toggle(g.companyId)} />
                <span className={ticked.has(g.companyId) ? "" : "line-through text-muted"}>{g.name}</span>
                {g.struck && !ticked.has(g.companyId) && <span className="text-[10px] text-amber-700">{tag(g.struck)}</span>}
              </li>
            ))}
          </ul>
          <div className="relative mt-3 max-w-sm">
            <input value={q} onChange={(e) => search(e.target.value)} placeholder="Add a group the sponsor asked for…" className="input text-sm" />
            {opts.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-paper shadow-lg">
                {opts.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-cream"
                      onClick={() =>
                        start(async () => {
                          setQ("");
                          setOpts([]);
                          await addGroupAction(dealId, o.id);
                          setDone(`${o.name} added.`);
                          router.refresh();
                        })
                      }
                    >
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            {all.length > 0 && (
              <DraftButton
                label="Draft engagement letter"
                readyLabel="Open letter in Outlook"
                disabled={ticked.size === 0 || pending}
                title="Drafts the engagement letter to the sponsor with the ticked groups, in your Outlook"
                action={async () => {
                  const r = await createEngagementLetter(dealId, [...ticked]);
                  if (r.ok) setDone(`Letter drafted with ${ticked.size} groups.`);
                  return r;
                }}
              />
            )}
            {!signed && all.length > 0 && (
              <button
                type="button"
                className="btn-primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await finalizeEngagementAction(dealId, [...ticked].filter((id) => groups.some((g) => g.companyId === id)), [...ticked].filter((id) => !groups.some((g) => g.companyId === id)));
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
    </div>
  );
}
