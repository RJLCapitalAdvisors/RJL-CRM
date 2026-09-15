import { PageHeader } from "@/components/ui";
import { RequiredWindows } from "@/components/required-items-editor";
import { ilWindows } from "@/lib/required-items";

export const metadata = { title: "Required Items Lists" };
export const dynamic = "force-dynamic";

/**
 * RJL Israel > Required Items Lists: what a complete ticket carries, as windows for apartments and houses (and the
 * project ticket). The email and WhatsApp replies list whichever lines are still blank; a ticket waits under Deals
 * to be approved until its list is satisfied.
 */
export default async function IlRequiredItemsPage() {
  const rows = await ilWindows();
  return (
    <>
      <PageHeader title="Required Items Lists" subtitle="What a complete ticket carries. The first windows are the defaults for apartments and houses; the plus opens another list. One item per line." />
      <div className="px-8 py-5">
        <RequiredWindows windows={rows.map((w) => ({ id: w.id, kind: w.kind, isDefault: w.isDefault, assetClasses: [], text: w.text }))} workspace="IL" />
        <div className="mt-4 text-xs text-muted">Changes save as you type and apply from the next message the deals mailbox reads. A line that matches a ticket field is satisfied by that field; any other line is a question of its own, answered under Other items on the ticket. A few follow-ups stay automatic: sukka and pool size when there is one, a ceiling per level, the project name on a yad rishona apartment, the renovation year on a second-hand unit.</div>
      </div>
    </>
  );
}
