import { ROLES, US_STATES, parseList } from "@/lib/taxonomy";
import { Field } from "./record-layout";

type CompanyLike = {
  name: string;
  roles: string;
  domain?: string | null;
  website: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  yearFounded: number | null;
  notes: string | null;
  ownerId: string | null;
} | null;

/** Company fields, stacked in one straight column (label above value), HubSpot style. */
export function CompanyForm({ company, users, action, submitLabel = "Save" }: { company: CompanyLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  const c = company;
  const roles = parseList(c?.roles);
  return (
    <form action={action}>
      <Field label="Company name" htmlFor="name">
        <input id="name" name="name" required defaultValue={c?.name ?? ""} className="input" />
      </Field>
      <Field label="Investor, Sponsor, Lender or Broker?">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} className="accent-ink" />
              {r}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Email domain" htmlFor="domain">
        <input id="domain" name="domain" defaultValue={c?.domain ?? ""} className="input" placeholder="citivestinc.com" />
      </Field>
      <Field label="Website" htmlFor="website">
        <input id="website" name="website" defaultValue={c?.website ?? ""} className="input" placeholder="https://" />
      </Field>
      <Field label="Street address" htmlFor="streetAddress">
        <input id="streetAddress" name="streetAddress" defaultValue={c?.streetAddress ?? ""} className="input" />
      </Field>
      <Field label="City" htmlFor="city">
        <input id="city" name="city" defaultValue={c?.city ?? ""} className="input" />
      </Field>
      <Field label="State" htmlFor="state">
        <select id="state" name="state" defaultValue={c?.state ?? ""} className="input">
          <option value="">—</option>
          {Object.entries(US_STATES).map(([code, name]) => (
            <option key={code} value={code}>
              {code} · {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Year founded" htmlFor="yearFounded">
        <input id="yearFounded" name="yearFounded" inputMode="numeric" defaultValue={c?.yearFounded ?? ""} className="input" />
      </Field>
      <Field label="Company owner" htmlFor="ownerId">
        <select id="ownerId" name="ownerId" defaultValue={c?.ownerId ?? ""} className="input">
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes" htmlFor="notes">
        <textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} className="input" />
      </Field>
      <div className="flex justify-end py-3">
        <button className="btn-primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
