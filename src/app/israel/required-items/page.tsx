import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { RequiredItemsEditor, type EditorRow } from "@/components/required-items-editor";
import { ilRequiredItems } from "@/lib/required-items";
import { IL_CATEGORIES, type IlCategory } from "@/lib/israel";

export const metadata = { title: "Required Items Lists" };
export const dynamic = "force-dynamic";

/**
 * RJL Israel > Required Items Lists: what a complete ticket carries, one list each for projects, apartments and
 * houses. The deals@rjlisrael.com and WhatsApp replies list whichever of these are still blank, the dashboard's
 * Deals to be approved shows the same, and Approve waits until the list is satisfied.
 */
export default async function IlRequiredItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  const category: IlCategory = IL_CATEGORIES.some((c) => c.key === raw) ? (raw as IlCategory) : "apartments";
  const all = await ilRequiredItems(category);
  const rows: EditorRow[] = all.map((r) => ({ id: r.id, key: r.key, label: r.label, devLabel: r.devLabel, question: r.question, kind: r.kind, strategies: [], assetClasses: null, core: r.core, active: r.active, fieldLabel: r.key.startsWith("x_") ? null : "Ticket field" }));
  return (
    <>
      <PageHeader title="Required Items Lists" subtitle="What a complete ticket carries. The email and WhatsApp replies ask for whichever of these are still blank, and a ticket waits under Deals to be approved until the list is satisfied." />
      <div className="flex flex-col gap-4 px-8 py-5">
        <div className="flex gap-1">
          {IL_CATEGORIES.map((c) => (
            <Link key={c.key} href={`/israel/required-items?category=${c.key}`} className={`rounded-md px-4 py-2 text-sm font-medium ${category === c.key ? "bg-ink text-paper" : "bg-cream text-ink hover:bg-sky/40"}`}>
              {c.label}
            </Link>
          ))}
        </div>
        <div className="text-sm text-muted">
          The order here is the order the agent reads in the reply. Changes save as you go and apply from the next message the deals mailbox reads. A few follow-ups stay automatic:
          {category === "houses" ? " sukka and pool size when there is one, the ceiling height per floor, the developer on a yad rishona house, the renovation year on a second-hand one." : category === "apartments" ? " sukka and pool size when there is one, a ceiling per level on a duplex, the project name on a yad rishona apartment, the renovation year on a second-hand one." : " a project's ranges (rooms, sizes, prices) come from its apartments and houses."}
        </div>
        <RequiredItemsEditor rows={rows} workspace="IL" category={category} />
      </div>
    </>
  );
}
