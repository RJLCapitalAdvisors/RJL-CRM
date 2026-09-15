"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { addRequiredItem, deleteRequiredItem, moveRequiredItem, saveRequiredItem, type RequiredItemPatch } from "@/app/required-items-actions";

/**
 * One Required Items List, edited in place. Every row saves itself when you leave the field (label, how it is
 * asked, type, what it applies to); the switch on the left turns an item on or off; the arrows order the list,
 * which is the order the sponsor or agent reads. An item that fills a ticket field carries a small tag and cannot
 * be deleted (switch it off instead); an item added here is a question of its own and can go.
 */

export type EditorRow = {
  id: string;
  key: string;
  label: string;
  devLabel: string | null;
  question: string | null;
  kind: string;
  strategies: string[];
  assetClasses: string[] | null;
  core: string | null;
  active: boolean;
  fieldLabel: string | null; // "Fills the Current occupancy field" for seeded items
};

const KINDS: { v: string; l: string }[] = [
  { v: "text", l: "Explanation" },
  { v: "short", l: "Short answer" },
  { v: "number", l: "Number" },
  { v: "yesno", l: "Yes or no" },
  { v: "doc", l: "Document" },
];

export function RequiredItemsEditor({ rows, workspace, category, strategy, assetClasses = [] }: { rows: EditorRow[]; workspace: "CA" | "IL"; category: string; strategy?: "Acquisitions" | "Development"; assetClasses?: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Nothing on this list yet. Add the first item below.</div>}
      {rows.map((r, i) => (
        <Row key={r.id} row={r} first={i === 0} last={i === rows.length - 1} workspace={workspace} strategy={strategy} assetClasses={assetClasses} />
      ))}
      <AddRow workspace={workspace} category={category} strategy={strategy} />
    </div>
  );
}

function Row({ row, first, last, workspace, strategy, assetClasses }: { row: EditorRow; first: boolean; last: boolean; workspace: "CA" | "IL"; strategy?: string; assetClasses: readonly string[] }) {
  const [r, setR] = useState(row);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const save = (patch: RequiredItemPatch) => {
    setR((cur) => ({ ...cur, ...patch } as EditorRow));
    start(async () => {
      await saveRequiredItem(row.id, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  };
  const custom = r.key.startsWith("x_");
  const allClasses = !r.assetClasses || r.assetClasses.length === 0;
  const toggleClass = (c: string) => {
    const cur = allClasses ? [...assetClasses] : [...r.assetClasses!];
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    save({ assetClasses: next.length >= assetClasses.length ? null : next });
  };
  const toggleStrategy = (s: string) => {
    const next = r.strategies.includes(s) ? r.strategies.filter((x) => x !== s) : [...r.strategies, s];
    if (!next.length) return; // an item has to apply to something
    save({ strategies: next });
  };
  return (
    <div className={`card px-4 py-3 ${r.active ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <label className="mt-2 flex shrink-0 items-center gap-2 text-xs text-muted" title={r.active ? "Asked for. Click to stop asking." : "Not asked for. Click to ask for it again."}>
          <input type="checkbox" checked={r.active} onChange={(e) => save({ active: e.target.checked })} className="h-4 w-4 accent-ink" />
          Ask
        </label>
        <div className="min-w-0 flex-1">
          <input
            defaultValue={r.label}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.label && save({ label: e.target.value.trim() })}
            className="input w-full text-base font-medium"
            aria-label="Item"
          />
          {workspace === "CA" && strategy === "Development" && (
            <input
              defaultValue={r.devLabel ?? ""}
              placeholder="Wording on a development (optional; the line above is used when blank)"
              onBlur={(e) => (e.target.value.trim() || "") !== (r.devLabel ?? "") && save({ devLabel: e.target.value.trim() || null })}
              className="input mt-1.5 w-full text-sm"
              aria-label="Development wording"
            />
          )}
          <textarea
            defaultValue={r.question ?? ""}
            placeholder={workspace === "CA" ? "How it is asked and what counts as an answer (the deals mailbox reads this)" : "How the reply asks for it (optional)"}
            onBlur={(e) => (e.target.value.trim() || "") !== (r.question ?? "") && save({ question: e.target.value.trim() || null })}
            rows={1}
            className="input mt-1.5 w-full resize-y text-sm"
            aria-label="How it is asked"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {r.fieldLabel ? <span className="chip bg-cream text-[11px]">{r.fieldLabel}</span> : <span className="chip bg-sky/40 text-[11px]">Question with no ticket field</span>}
            {workspace === "CA" && !r.core && (
              <label className="flex items-center gap-1.5 text-muted">
                Type
                <select value={r.kind} onChange={(e) => save({ kind: e.target.value })} className="input py-0.5 text-xs">
                  {KINDS.map((k) => (
                    <option key={k.v} value={k.v}>
                      {k.l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {workspace === "CA" && (
              <span className="flex items-center gap-2 text-muted">
                Applies to
                {["Acquisitions", "Development"].map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input type="checkbox" checked={r.strategies.includes(s)} onChange={() => toggleStrategy(s)} className="accent-ink" />
                    {s}
                  </label>
                ))}
              </span>
            )}
            {saved && <span className="text-emerald-700">Saved</span>}
            {pending && !saved && <span className="text-muted">Saving…</span>}
          </div>
          {workspace === "CA" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => !allClasses && save({ assetClasses: null })} className={`chip text-[11px] ${allClasses ? "bg-ink text-paper" : "bg-cream hover:bg-sky/40"}`} title="Ask for this on every asset class">
                All asset classes
              </button>
              {assetClasses.map((c) => {
                const on = allClasses || r.assetClasses!.includes(c);
                return (
                  <button key={c} type="button" onClick={() => toggleClass(c)} className={`chip text-[11px] ${on && !allClasses ? "bg-ink text-paper" : on ? "bg-sky/40" : "bg-cream line-through opacity-60 hover:opacity-100"}`} title={on ? `Asked for on ${c}. Click to skip it there.` : `Not asked for on ${c}. Click to ask for it there.`}>
                    {c}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button type="button" disabled={first || pending} onClick={() => start(() => moveRequiredItem(row.id, -1))} className="btn-ghost p-1 disabled:opacity-30" title="Move up">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={last || pending} onClick={() => start(() => moveRequiredItem(row.id, 1))} className="btn-ghost p-1 disabled:opacity-30" title="Move down">
            <ArrowDown className="h-4 w-4" />
          </button>
          {custom && (
            <button type="button" disabled={pending} onClick={() => confirm(`Remove "${r.label}" from the list?`) && start(() => deleteRequiredItem(row.id))} className="btn-ghost p-1 text-red-700" title="Remove this item">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddRow({ workspace, category, strategy }: { workspace: "CA" | "IL"; category: string; strategy?: string }) {
  const [pending, start] = useTransition();
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      action={(fd) =>
        start(async () => {
          await addRequiredItem(workspace, category, fd);
          setKey((k) => k + 1); // a fresh, empty form
        })
      }
      className="card flex flex-wrap items-end gap-3 border-dashed px-4 py-3"
    >
      <label className="min-w-[240px] flex-1 text-sm">
        <div className="label">New item</div>
        <input name="label" required placeholder={workspace === "CA" ? "e.g. Environmental report (Phase I)" : "e.g. Vaad bayit (monthly building fee)"} className="input w-full" />
      </label>
      <label className="min-w-[240px] flex-[2] text-sm">
        <div className="label">How it is asked (optional)</div>
        <input name="question" placeholder="Plain words; the reply lists the item as written above when blank" className="input w-full" />
      </label>
      {workspace === "CA" && (
        <>
          <label className="text-sm">
            <div className="label">Type</div>
            <select name="kind" defaultValue="text" className="input">
              {KINDS.map((k) => (
                <option key={k.v} value={k.v}>
                  {k.l}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3 pb-2 text-xs text-muted">
            <label className="flex items-center gap-1">
              <input type="checkbox" name="strategies" value="Acquisitions" defaultChecked={strategy !== "Development"} className="accent-ink" /> Acquisitions
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="strategies" value="Development" defaultChecked={strategy === "Development"} className="accent-ink" /> Development
            </label>
          </div>
        </>
      )}
      <button type="submit" disabled={pending} className="btn-primary px-4 py-2 text-sm">
        {pending ? "Adding…" : "Add item"}
      </button>
    </form>
  );
}
