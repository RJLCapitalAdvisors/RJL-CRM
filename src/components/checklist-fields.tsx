import { applicableItems, answerFor, itemLabel, type ChecklistItem, type DealLikeForChecklist } from "@/lib/checklist";

/**
 * Renders the applicable checklist items as form fields named `detail.<key>`.
 * Items mapped to a core Deal column are shown read-only here (edit them in the main form).
 */
export function ChecklistFields({ deal, showCore = true }: { deal: DealLikeForChecklist; showCore?: boolean }) {
  const items = applicableItems(deal.strategy, deal.assetClass);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      {items.map((it) => (
        <ChecklistField key={it.key} item={it} deal={deal} showCore={showCore} />
      ))}
    </div>
  );
}

function ChecklistField({ item, deal, showCore }: { item: ChecklistItem; deal: DealLikeForChecklist; showCore: boolean }) {
  const label = itemLabel(item, deal.strategy);
  const answer = answerFor(item, deal);
  const missing = !answer;
  const cls = `input ${missing ? "border-amber-300 bg-amber-50/40" : ""}`;
  const name = `detail.${item.key}`;

  if (item.core && !showCore) return null;
  if (item.core) {
    return (
      <div className={item.kind === "text" ? "col-span-2" : ""}>
        <div className="label">{label}</div>
        <div className={`rounded-md border px-3 py-2 text-sm ${missing ? "border-amber-300 bg-amber-50/40 text-muted" : "border-line bg-cream-50"}`}>{answer ?? "Not provided – fill in the deal form above"}</div>
        <div className="mt-0.5 text-[11px] text-muted">{item.question}</div>
      </div>
    );
  }

  switch (item.kind) {
    case "doc":
      return (
        <div>
          <div className="label">{label}</div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name={`${name}.received`} defaultChecked={Boolean(answer)} className="accent-ink" /> Received
            </label>
            <input name={name} defaultValue={answer && answer !== "Received" ? answer : ""} placeholder="Notes / file name" className={`${cls} flex-1`} />
          </div>
          <div className="mt-0.5 text-[11px] text-muted">{item.question}</div>
        </div>
      );
    case "yesno":
      return (
        <div>
          <label className="label" htmlFor={name}>
            {label}
          </label>
          <select id={name} name={name} defaultValue={answer ?? ""} className={cls}>
            <option value="">—</option>
            <option>Yes</option>
            <option>No</option>
          </select>
          <div className="mt-0.5 text-[11px] text-muted">{item.question}</div>
        </div>
      );
    case "text":
      return (
        <div className="col-span-2">
          <label className="label" htmlFor={name}>
            {label}
          </label>
          <textarea id={name} name={name} rows={3} defaultValue={answer ?? ""} className={cls} />
          <div className="mt-0.5 text-[11px] text-muted">{item.question}</div>
        </div>
      );
    default:
      return (
        <div>
          <label className="label" htmlFor={name}>
            {label}
          </label>
          <input id={name} name={name} defaultValue={answer ?? ""} className={cls} inputMode={item.kind === "number" ? "decimal" : undefined} />
          <div className="mt-0.5 text-[11px] text-muted">{item.question}</div>
        </div>
      );
  }
}

/** Read `detail.<key>` fields from a submitted form into a details object. */
export function detailsFromForm(fd: FormData, existing: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = { ...existing };
  for (const it of applicableItems(null, null)) {
    if (it.core) continue;
    const raw = fd.get(`detail.${it.key}`);
    if (raw == null) continue; // field not rendered (not applicable) – keep existing
    const v = typeof raw === "string" ? raw.trim() : "";
    if (it.kind === "doc") {
      const received = fd.get(`detail.${it.key}.received`) === "on";
      out[it.key] = v ? v : received ? "Received" : null;
    } else out[it.key] = v || null;
  }
  return out;
}
