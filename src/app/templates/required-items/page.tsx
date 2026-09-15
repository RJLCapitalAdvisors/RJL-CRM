import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { RequiredItemsEditor, type EditorRow } from "@/components/required-items-editor";
import { caRequiredItems, parseList } from "@/lib/required-items";
import { ASSET_CLASSES } from "@/lib/taxonomy";

export const metadata = { title: "Required Items Lists" };
export const dynamic = "force-dynamic";

const CORE_LABEL: Record<string, string> = {
  occupancy: "Fills the Current occupancy field",
  summary: "Fills the Business plan field",
  sponsorExperience: "Fills the Sponsor bio field",
  onMarket: "Fills the On or off market field",
  ltv: "Fills the LTV field",
  loanTerm: "Fills the Loan term field",
  expectedClose: "Fills the Expected close field",
  purchasePrice: "Fills the Purchase or land price field",
  yieldOnCost: "Fills the Yield on cost field",
};

/**
 * Templates > Required Items Lists (RJL Capital Advisors). What we ask a sponsor for before a deal goes to market,
 * one list for acquisitions and one for developments, each item marked with the asset classes it applies to.
 * The deals mailbox, the intake page, Still needed on the ticket and Items Needed from Sponsor on the progress
 * report all read from here, so a change on this page changes what gets asked from the next email on.
 */
export default async function RequiredItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const strategy = (Array.isArray(sp.strategy) ? sp.strategy[0] : sp.strategy) === "Development" ? "Development" : "Acquisitions";
  const assetClass = (Array.isArray(sp.assetClass) ? sp.assetClass[0] : sp.assetClass) || "";
  const all = await caRequiredItems();
  const rows: EditorRow[] = all
    .map((r) => ({ id: r.id, key: r.key, label: r.label, devLabel: r.devLabel, question: r.question, kind: r.kind, strategies: parseList(r.strategies), assetClasses: r.assetClasses ? parseList(r.assetClasses) : null, core: r.core, active: r.active, fieldLabel: r.core ? (CORE_LABEL[r.core] ?? "Fills a ticket field") : r.key.startsWith("x_") ? null : "Ticket checklist item" }))
    .filter((r) => r.strategies.includes(strategy))
    .filter((r) => !assetClass || !r.assetClasses || r.assetClasses.includes(assetClass));
  const tab = (s: string, label: string) => (
    <Link href={`/templates/required-items?strategy=${s}${assetClass ? `&assetClass=${encodeURIComponent(assetClass)}` : ""}`} className={`rounded-md px-4 py-2 text-sm font-medium ${strategy === s ? "bg-ink text-paper" : "bg-cream text-ink hover:bg-sky/40"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Required Items Lists" subtitle="What we ask a sponsor for, by acquisition or development and by asset class. The deals mailbox, the intake page and Items Needed from Sponsor read from these lists." />
      <div className="flex flex-col gap-4 px-8 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {tab("Acquisitions", "Acquisitions")}
            {tab("Development", "Development")}
          </div>
          <form className="ml-auto flex items-center gap-2 text-sm">
            <input type="hidden" name="strategy" value={strategy} />
            <label htmlFor="assetClass" className="text-muted">
              Show the list for
            </label>
            <select id="assetClass" name="assetClass" defaultValue={assetClass} className="input py-1.5 text-sm">
              <option value="">Every asset class</option>
              {ASSET_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-grey px-3 py-1.5 text-xs">
              Show
            </button>
          </form>
        </div>
        <div className="text-sm text-muted">
          {assetClass ? `The ${rows.length} items a ${strategy === "Development" ? "development" : "acquisition"} in ${assetClass} is asked for, in the order the sponsor reads them.` : `Every item on the ${strategy === "Development" ? "development" : "acquisition"} list. Grey chips are the asset classes each item applies to; click one to skip the item there.`}
          {" "}Changes save as you go and apply from the next email the deals mailbox reads.
        </div>
        <RequiredItemsEditor rows={rows} workspace="CA" category="deal" strategy={strategy} assetClasses={ASSET_CLASSES} />
      </div>
    </>
  );
}
