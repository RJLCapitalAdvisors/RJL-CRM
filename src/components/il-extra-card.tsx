import { IL_REQUIRED, isCustomKey, parseExtra, type IlCategory } from "@/lib/israel";
import { saveIlExtra } from "@/app/israel/actions";

/**
 * "Other items" on an RJL Israel ticket: the answers to Required Items List questions that have no field of their
 * own (the ones Jonathan adds on the list page). Blank ones count as still needed until filled in here or by the
 * next email about the unit.
 */
export function IlExtraCard({ kind, id, extra }: { kind: IlCategory; id: string; extra: string | null | undefined }) {
  const items = IL_REQUIRED[kind].filter((i) => isCustomKey(i.key));
  if (!items.length) return null;
  const cur = parseExtra(extra);
  return (
    <div className="card">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">Other items</div>
      <form action={saveIlExtra.bind(null, kind, id)} className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        {items.map((i) => (
          <label key={i.key} className="text-sm">
            <div className="label">{i.label}</div>
            <input name={i.key} defaultValue={cur[i.key] ?? ""} className={`input w-full ${cur[i.key] ? "" : "border-amber-300 bg-amber-50/40"}`} />
          </label>
        ))}
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary px-3 py-1.5 text-xs">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
