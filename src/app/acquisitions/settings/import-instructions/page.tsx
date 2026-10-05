import { PageHeader } from "@/components/ui";
import { AutoSaveForm } from "@/components/autosave-form";
import { importInstructionsText } from "@/lib/aq-import-instructions";
import { saveImportInstructionsAction } from "../../actions";

export const metadata = { title: "Import instructions" };
export const dynamic = "force-dynamic";

/**
 * Settings > Import instructions (Oct 5, 2026): the standing directions Shawn gives Ask the CRM for every call-list
 * export he drops in. Given once in the chat ("from now on, for every file: …") they land here; edit them here any
 * time, they save as you type, and the next file is read with them. Data rules (one-line lessons) sit beside them.
 */
export default async function AqImportInstructionsPage() {
  const { text, savedAt } = await importInstructionsText();
  return (
    <>
      <PageHeader title="Import instructions" subtitle="What Ask the CRM does with every call list dropped into RJL Acquisitions. Plain English; it saves as you type and applies to every future file." />
      <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2">
            <div className="text-sm font-semibold">Standing instructions</div>
            <div className="text-[11px] text-muted">{savedAt ? `Last saved ${savedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Nothing given yet"}</div>
          </div>
          <AutoSaveForm action={saveImportInstructionsAction} className="p-4">
            <textarea
              name="text"
              defaultValue={text}
              spellCheck
              placeholder={"For example:\nEvery file is a Terakotta export, one row per phone number. Fold the rows by parcel ID into one property with every number on its owner.\nA row whose Result column says WN is a wrong number: junk that number with the reason Wrong number.\nPut the file name in Source List on every property it creates.\nRows with no address are skipped; tell me which ones."}
              className="input min-h-[420px] w-full resize-y text-[13px] leading-6"
            />
            <div className="mt-2 text-xs text-muted">
              Written the way you would brief a new analyst on the files. You can also give them in <a href="/acquisitions/ask" className="text-sky-700 hover:underline">Ask the CRM</a>: say &quot;for every file from now on…&quot; and they land here. Column-by-column lessons go to <a href="/acquisitions/settings/data-rules" className="text-sky-700 hover:underline">Data rules</a>.
            </div>
          </AutoSaveForm>
        </div>
      </div>
    </>
  );
}
