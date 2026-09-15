import { PageHeader } from "@/components/ui";
import { RequiredWindows } from "@/components/required-items-editor";
import { caWindows, parseList } from "@/lib/required-items";
import { ASSET_CLASSES } from "@/lib/taxonomy";

export const metadata = { title: "Required Items Lists" };
export const dynamic = "force-dynamic";

/**
 * Templates > Required Items Lists (RJL Capital Advisors): what we ask a sponsor for before a deal goes to market, as
 * windows. The two default windows (acquisitions, developments) cover every asset class that has no window of its
 * own; a window with asset classes picked replaces the default for those classes. The deals mailbox, the intake
 * page, Still needed and Items Needed from Sponsor read these lists.
 */
export default async function RequiredItemsPage() {
  const rows = await caWindows();
  return (
    <>
      <PageHeader title="Required Items Lists" subtitle="What we ask a sponsor for. The first two windows are the defaults; a window with asset classes picked takes over for those classes. One item per line." />
      <div className="px-8 py-5">
        <RequiredWindows windows={rows.map((w) => ({ id: w.id, kind: w.kind, isDefault: w.isDefault, assetClasses: parseList(w.assetClasses), text: w.text }))} workspace="CA" assetClasses={ASSET_CLASSES} />
        <div className="mt-4 text-xs text-muted">Changes save as you type and apply from the next email the deals mailbox reads. A line that matches a built-in item keeps its behavior (the Excel model counts only when an Excel file arrives; Current occupancy fills the occupancy field); any other line becomes a question of its own.</div>
      </div>
    </>
  );
}
