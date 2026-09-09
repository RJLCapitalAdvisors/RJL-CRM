import { Field } from "@/components/record-layout";
import { IL_ROLES, parseJsonList } from "@/lib/israel";

type Ct = Partial<{ firstName: string | null; lastName: string | null; email: string | null; phone: string | null; companyId: string | null; roles: string; language: string | null; budgetMinNis: number | null; budgetMaxNis: number | null; wantsCities: string | null; wantsRooms: string | null; notes: string | null }>;

export function IlContactForm({ c = {}, companies, action, submitLabel = "Save" }: { c?: Ct; companies: { id: string; name: string }[]; action: (fd: FormData) => Promise<void>; submitLabel?: string }) {
  const roles = parseJsonList(c.roles);
  const v = (x: number | null | undefined) => (x == null ? "" : String(x));
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" htmlFor="firstName">
          <input id="firstName" name="firstName" defaultValue={c.firstName ?? ""} className="input" />
        </Field>
        <Field label="Last name" htmlFor="lastName">
          <input id="lastName" name="lastName" defaultValue={c.lastName ?? ""} className="input" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" defaultValue={c.email ?? ""} className="input" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <input id="phone" name="phone" defaultValue={c.phone ?? ""} className="input" placeholder="+972 5x xxx xxxx" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company" htmlFor="companyId">
          <select id="companyId" name="companyId" defaultValue={c.companyId ?? ""} className="input">
            <option value="">None</option>
            {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
        </Field>
        <Field label="Language" htmlFor="language">
          <select id="language" name="language" defaultValue={c.language ?? ""} className="input">
            <option value="">Not set</option>
            <option>English</option>
            <option>Hebrew</option>
            <option>French</option>
            <option>Russian</option>
            <option>Spanish</option>
          </select>
        </Field>
      </div>
      <Field label="Roles">
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          {IL_ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5">
              <input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} className="accent-ink" /> {r}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget from (₪)" htmlFor="budgetMinNis">
          <input id="budgetMinNis" name="budgetMinNis" type="number" step="10000" defaultValue={v(c.budgetMinNis)} className="input" />
        </Field>
        <Field label="Budget to (₪)" htmlFor="budgetMaxNis">
          <input id="budgetMaxNis" name="budgetMaxNis" type="number" step="10000" defaultValue={v(c.budgetMaxNis)} className="input" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wants: cities" htmlFor="wantsCities">
          <input id="wantsCities" name="wantsCities" defaultValue={c.wantsCities ?? ""} className="input" placeholder="Jerusalem, Ra'anana" />
        </Field>
        <Field label="Wants: rooms" htmlFor="wantsRooms">
          <input id="wantsRooms" name="wantsRooms" defaultValue={c.wantsRooms ?? ""} className="input" placeholder="4-5" />
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
