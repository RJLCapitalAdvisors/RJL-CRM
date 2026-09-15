"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { GrowingTextarea } from "@/components/growing-textarea";
import { addRequiredList, deleteRequiredList, saveRequiredList } from "@/app/required-items-actions";

/**
 * Required Items Lists as a row of square windows. Each window is one bulleted list with, on top, what it is for:
 * RJL Capital Advisors toggles Acquisitions or Development and picks the asset classes; RJL Israel toggles Apartments
 * or Houses. The first windows are the defaults (one per kind) and cover whatever has no window of its own; their
 * heading is fixed. The plus square after the last window opens a new one. Text saves itself as you type.
 */

export type WindowRow = { id: string; kind: string; isDefault: boolean; assetClasses: string[]; text: string };

const CA_KIND_LABEL: Record<string, string> = { Acquisitions: "Acquisitions", Development: "Development" };
const IL_KIND_LABEL: Record<string, string> = { apartments: "Apartments", houses: "Houses", projects: "Projects" };

export function RequiredWindows({ windows, workspace, assetClasses = [] }: { windows: WindowRow[]; workspace: "CA" | "IL"; assetClasses?: readonly string[] }) {
  const [pending, start] = useTransition();
  const label = workspace === "CA" ? CA_KIND_LABEL : IL_KIND_LABEL;
  const kinds = workspace === "CA" ? ["Acquisitions", "Development"] : ["apartments", "houses"];
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {windows.map((w) => (
        <Window key={w.id} w={w} workspace={workspace} kinds={kinds} label={label} assetClasses={assetClasses} />
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => addRequiredList(workspace))}
        className="flex aspect-square min-h-[280px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-muted transition hover:border-sky-600 hover:text-ink disabled:opacity-50"
        title="Add a window"
      >
        <Plus className="h-10 w-10" />
        <span className="text-sm">{pending ? "Adding…" : "New list"}</span>
      </button>
    </div>
  );
}

function Window({ w, workspace, kinds, label, assetClasses }: { w: WindowRow; workspace: "CA" | "IL"; kinds: string[]; label: Record<string, string>; assetClasses: readonly string[] }) {
  const [kind, setKind] = useState(w.kind);
  const [classes, setClasses] = useState<string[]>(w.assetClasses);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const ca = workspace === "CA";
  const setK = (k: string) => {
    setKind(k);
    start(() => saveRequiredList(w.id, { kind: k }));
  };
  const toggleClass = (c: string) => {
    const next = classes.includes(c) ? classes.filter((x) => x !== c) : [...classes, c];
    setClasses(next);
    start(() => saveRequiredList(w.id, { assetClasses: next }));
  };
  const heading = w.isDefault ? (
    <div>
      <div className="text-sm font-semibold">{label[w.kind] ?? w.kind}</div>
      <div className="text-[11px] text-muted">{ca ? "Any asset class without its own window" : "The default list"}</div>
    </div>
  ) : (
    <div className="min-w-0 flex-1">
      <div className="flex rounded-md border border-line text-xs">
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => setK(k)} className={`flex-1 px-2 py-1 first:rounded-l-md last:rounded-r-md ${kind === k ? "bg-ink text-paper" : "hover:bg-sky/40"}`}>
            {label[k] ?? k}
          </button>
        ))}
      </div>
      {ca && (
        <button type="button" onClick={() => setPicking((p) => !p)} className={`mt-1.5 w-full truncate rounded-md border border-line px-2 py-1 text-left text-xs ${classes.length ? "" : "text-amber-700"}`} title="Which asset classes this list is for">
          {classes.length ? classes.join(", ") : "Pick the asset classes"}
        </button>
      )}
      {ca && picking && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {assetClasses.map((c) => (
            <button key={c} type="button" onClick={() => toggleClass(c)} className={`chip text-[10px] ${classes.includes(c) ? "bg-ink text-paper" : "bg-cream hover:bg-sky/40"}`}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div className={`card flex aspect-square min-h-[280px] flex-col ${pending ? "opacity-80" : ""}`}>
      <div className="flex items-start gap-2 border-b border-line bg-cream px-3 py-2">
        {heading}
        {!w.isDefault && (
          <button type="button" onClick={() => confirm("Remove this list?") && start(() => deleteRequiredList(w.id))} className="btn-ghost shrink-0 p-1 text-muted hover:text-red-700" title="Remove this list">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm">
        <GrowingTextarea defaultValue={w.text} bullets minRows={8} placeholder="• One item per line" onSave={(v) => saveRequiredList(w.id, { text: v })} />
      </div>
    </div>
  );
}
