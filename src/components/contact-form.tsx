import { ROLES, parseList } from "@/lib/taxonomy";
import { CompanyPicker } from "./company-picker";
import { Field } from "./record-layout";

type ContactLike = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  roles: string;
  accredited: boolean | null;
  streetAddress: string | null;
  notes: string | null;
  ownerId: string | null;
  marketingContact: boolean;
  unsubscribed: boolean;
  company: { id: string; name: string; city: string | null; state: string | null } | null;
} | null;

/** Contact fields, stacked in one straight column (label above value), HubSpot style. */
export function ContactForm({ contact, users, action, submitLabel = "Save" }: { contact: ContactLike; users: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; submitLabel?: string }) {
  const c = contact;
  const roles = parseList(c?.roles);
  return (
    <form action={action}>
      <Field label="First name" htmlFor="firstName">
        <input id="firstName" name="firstName" defaultValue={c?.firstName ?? ""} className="input" />
      </Field>
      <Field label="Last name" htmlFor="lastName">
        <input id="lastName" name="lastName" defaultValue={c?.lastName ?? ""} className="input" />
      </Field>
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" defaultValue={c?.email ?? ""} className="input" />
      </Field>
      <Field label="Phone number" htmlFor="phone">
        <input id="phone" name="phone" defaultValue={c?.phone ?? ""} className="input" />
      </Field>
      <Field label="Title" htmlFor="title">
        <input id="title" name="title" defaultValue={c?.title ?? ""} className="input" />
      </Field>
      <Field label="Company">
        <CompanyPicker initial={c?.company ?? null} />
      </Field>
      <Field label="Sponsor, Lender, Investor, Retail Investor, or Broker?">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} className="accent-ink" />
              {r}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Accredited investor?" htmlFor="accredited">
        <select id="accredited" name="accredited" defaultValue={c?.accredited == null ? "" : c.accredited ? "yes" : "no"} className="input">
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Contact owner" htmlFor="ownerId">
        <select id="ownerId" name="ownerId" defaultValue={c?.ownerId ?? ""} className="input">
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Email status">
        <div className="flex flex-col gap-1.5 pt-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="marketingContact" defaultChecked={c?.marketingContact ?? true} className="accent-ink" /> Marketing contact
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="unsubscribed" defaultChecked={c?.unsubscribed ?? false} className="accent-ink" /> Unsubscribed
          </label>
        </div>
      </Field>
      <Field label="Street address" htmlFor="streetAddress">
        <input id="streetAddress" name="streetAddress" defaultValue={c?.streetAddress ?? ""} className="input" />
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
