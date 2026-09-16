import { PageHeader } from "@/components/ui";
import { AutoSaveForm } from "@/components/autosave-form";
import { BUILT_IN_RULES, FORMAT_RULES, underwritingRulesText } from "@/lib/underwriting-rules";
import { saveUnderwritingRules } from "./actions";

export const metadata = { title: "Underwriting rules" };
export const dynamic = "force-dynamic";

/**
 * Settings > Underwriting rules: the house rules the deals@ extractor reads on every email, one per line, saved as
 * you type. When a deal comes out wrong, the fix is a sharper line here. Below the window: what the code enforces
 * on its own and the format rules the schema depends on, both read-only.
 */
export default async function UnderwritingRulesPage() {
  const { text, savedAt } = await underwritingRulesText();
  return (
    <>
      <PageHeader
        title="Underwriting rules"
        subtitle="What deals@ is told before it reads a deal. One rule per line, plain English. It saves as you type and the next email is read with it."
      />
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-6">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line bg-cream px-4 py-2">
            <div className="text-sm font-semibold">House rules</div>
            <div className="text-[11px] text-muted">{savedAt ? `Last saved ${savedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not edited yet: these are the rules given so far"}</div>
          </div>
          <AutoSaveForm action={saveUnderwritingRules} className="p-4">
            <textarea name="text" defaultValue={text} spellCheck className="input min-h-[620px] w-full resize-y text-[13px] leading-6" />
            <div className="mt-2 text-xs text-muted">
              Write each rule the way you would tell a new analyst: what to read, where in the model, what to do when it is ambiguous. Ask the extractor to mention anything uncertain in confidenceNotes so it shows on the ticket. When a deal comes out wrong, tell Claude what the right values were and the fix lands here.
            </div>
          </AutoSaveForm>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="card">
            <div className="border-b border-line bg-cream px-4 py-2 text-sm font-semibold">Built into the code</div>
            <ul className="list-disc space-y-2 px-4 py-3 pl-8 text-sm">
              {BUILT_IN_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-2 text-[11px] text-muted">Applied after every extraction whatever the model returned. Changing these is a code change, not a line above.</div>
          </div>
          <div className="card">
            <div className="border-b border-line bg-cream px-4 py-2 text-sm font-semibold">Format rules</div>
            <ul className="list-disc space-y-2 px-4 py-3 pl-8 text-sm">
              {FORMAT_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-2 text-[11px] text-muted">How values are written so they land in the right fields. The ticket depends on these, so they stay in code.</div>
          </div>
        </div>
      </div>
    </>
  );
}
