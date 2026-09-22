import { PageHeader } from "@/components/ui";
import { AutoSaveForm } from "@/components/autosave-form";
import type { Workspace } from "@/lib/access";
import { dataRulesText } from "@/lib/data-rules";
import { saveDataRulesAction, saveReportRulesAction } from "@/app/ask/actions";
import { reportRulesText } from "@/lib/report-rules";

const NAMES: Record<Workspace, string> = { CA: "RJL Capital Advisors", IL: "RJL Israel", AQ: "RJL Acquisitions" };
const ASK: Record<Workspace, string> = { CA: "/ask", IL: "/israel/ask", AQ: "/acquisitions/ask" };

/**
 * Settings > Data rules, one page per side: everything the assistant has been taught about reading this side's
 * files, one rule per line, saved as you type. Teaching happens in Ask the CRM ("the Owner column is the seller,
 * not the operator") and lands here; pasting a batch of rules here works the same way.
 */
export async function DataRulesPage({ workspace }: { workspace: Workspace }) {
  const { text, savedAt } = await dataRulesText(workspace);
  const count = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const report = workspace === "CA" ? await reportRulesText() : null;
  return (
    <>
      <PageHeader title="Data rules" subtitle={workspace === "CA" ? "How progress reports are kept, and how Ask the CRM reads files. One rule per line, plain English; it saves as you type." : `How Ask the CRM reads files dropped into ${NAMES[workspace]}: one rule per line, plain English. It saves as you type and the next file is read with it.`} />
      <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
        {report && (
          <div className="card">
            <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2">
              <div className="text-sm font-semibold">
                Progress report rules <span className="ml-1 font-normal text-muted">{report.text.split(/\r?\n/).filter((l) => l.trim()).length}</span>
              </div>
              <div className="text-[11px] text-muted">{report.savedAt ? `Last saved ${report.savedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not edited yet: these are the rules given so far"}</div>
            </div>
            <AutoSaveForm action={saveReportRulesAction} className="p-4">
              <textarea name="text" defaultValue={report.text} spellCheck className="input min-h-[360px] w-full resize-y text-[13px] leading-6" />
              <div className="mt-2 text-xs text-muted">How the investor rows, Notable Feedback Themes and Items Needed from Sponsor are kept. The mechanical rules (statuses, what a pass keeps, bullets, order) are built into the code as written here; the wording rules go to the writer with every note, theme and item.</div>
            </AutoSaveForm>
          </div>
        )}
        <div className="card">
          <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2">
            <div className="text-sm font-semibold">
              {workspace === "CA" ? "File reading rules" : "Rules"} <span className="ml-1 font-normal text-muted">{count}</span>
            </div>
            <div className="text-[11px] text-muted">{savedAt ? `Last saved ${savedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Nothing taught yet"}</div>
          </div>
          <AutoSaveForm action={saveDataRulesAction.bind(null, workspace)} className="p-4">
            <textarea name="text" defaultValue={text} spellCheck placeholder={"One rule per line, for example:\nThe sheet's Owner column is the company; the Contact column is the person at it.\nA row whose Status says DNC is Not interested.\nAddresses are street only; the City column holds the city and the borough is the neighborhood."} className="input min-h-[520px] w-full resize-y text-[13px] leading-6" />
            <div className="mt-2 text-xs text-muted">
              Write each rule the way you would tell a new analyst: which column means what, which rows to skip, how to read a code or an abbreviation. You can also teach in <a href={ASK[workspace]} className="text-sky-700 hover:underline">Ask the CRM</a>: say &quot;remember: …&quot; or correct it after a file, and the rule lands here.
            </div>
          </AutoSaveForm>
        </div>
      </div>
    </>
  );
}
