import { Field } from "@/components/record-layout";
import { IL_CITIES, IL_COMPANY_KINDS } from "@/lib/israel";

type Co = Partial<{ name: string; kind: string | null; city: string | null; website: string | null; phone: string | null; notes: string | null }>;

export function IlCompanyForm({ c = {}, action, submitLabel = "Save" }: { c?: Co; action: (fd: FormData) => Promise<void>; submitLabel?: string }) {
  return (
    <form action={action} className="space-y-3">
      <Field label="Name" htmlFor="name">
        <input id="name" name="name" defaultValue={c.name ?? ""} className="input" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" htmlFor="kind">
          <select id="kind" name="kind" defaultValue={c.kind ?? ""} className="input">
            <option value="">Not set</option>
            {IL_COMPANY_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="City" htmlFor="city">
          <input id="city" name="city" defaultValue={c.city ?? ""} className="input" list="il-cities-co" />
          <datalist id="il-cities-co">{IL_CITIES.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Website" htmlFor="website">
          <input id="website" name="website" defaultValue={c.website ?? ""} className="input" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <input id="phone" name="phone" defaultValue={c.phone ?? ""} className="input" />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <textarea id="notes" name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" />
      </Field>
      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </form>
  );
}
