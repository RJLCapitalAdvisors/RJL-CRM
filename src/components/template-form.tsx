import { MERGE_FIELDS } from "@/lib/merge";

type T = { name: string; subject: string; bodyHtml: string } | null;

export function TemplateForm({ template, action, submitLabel = "Save template" }: { template: T; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  return (
    <form action={action} className="grid grid-cols-3 gap-6">
      <div className="col-span-2 space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Template name
          </label>
          <input id="name" name="name" required defaultValue={template?.name ?? ""} className="input" placeholder="Deal intro to investors" />
        </div>
        <div>
          <label className="label" htmlFor="subject">
            Subject
          </label>
          <input id="subject" name="subject" required defaultValue={template?.subject ?? ""} className="input" placeholder="{{deal.propertyName}} – {{deal.requestedAmount}} {{deal.requestType}} opportunity" />
        </div>
        <div>
          <label className="label" htmlFor="bodyHtml">
            Body (plain text with merge fields, or HTML)
          </label>
          <textarea id="bodyHtml" name="bodyHtml" rows={18} defaultValue={template?.bodyHtml ?? ""} className="input font-mono text-[13px]" />
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" type="submit">
            {submitLabel}
          </button>
        </div>
      </div>
      <aside className="card self-start p-4 text-sm">
        <div className="mb-2 font-semibold">Merge fields</div>
        <p className="mb-3 text-xs text-muted">
          Type a field as <code className="rounded bg-cream px-1">{"{{deal.propertyName}}"}</code>. Add a fallback with a pipe: <code className="rounded bg-cream px-1">{"{{contact.firstName|there}}"}</code>.
        </p>
        <ul className="space-y-1">
          {MERGE_FIELDS.map((f) => (
            <li key={f.key} className="flex items-baseline justify-between gap-2">
              <code className="text-xs">{`{{${f.key}}}`}</code>
              <span className="text-right text-xs text-muted">{f.label}</span>
            </li>
          ))}
        </ul>
      </aside>
    </form>
  );
}
