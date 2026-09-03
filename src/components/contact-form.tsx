import { ROLES, parseList } from "@/lib/taxonomy";
import { CompanyPicker } from "./company-picker";

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

export function ContactForm({
  contact,
  users,
  action,
  submitLabel = "Save",
}: {
  contact: ContactLike;
  users: { id: string; name: string }[];
  action: (fd: FormData) => void | Promise<void>;
  submitLabel?: string;
}) {
  const c = contact;
  const roles = parseList(c?.roles);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="firstName">
            First name
          </label>
          <input id="firstName" name="firstName" defaultValue={c?.firstName ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="lastName">
            Last name
          </label>
          <input id="lastName" name="lastName" defaultValue={c?.lastName ?? ""} className="input" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" defaultValue={c?.email ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" defaultValue={c?.phone ?? ""} className="input" />
        </div>
      </div>
      <div>
        <div className="label">Company</div>
        <CompanyPicker initial={c?.company ?? null} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input id="title" name="title" defaultValue={c?.title ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="ownerId">
            Owner
          </label>
          <select id="ownerId" name="ownerId" defaultValue={c?.ownerId ?? ""} className="input">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className="label">Roles</div>
        <div className="flex flex-wrap gap-4">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} className="accent-ink" />
              {r}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label" htmlFor="accredited">
            Accredited investor
          </label>
          <select id="accredited" name="accredited" defaultValue={c?.accredited == null ? "" : c.accredited ? "yes" : "no"} className="input">
            <option value="">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" name="marketingContact" defaultChecked={c?.marketingContact ?? true} className="accent-ink" />
          Marketing contact
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" name="unsubscribed" defaultChecked={c?.unsubscribed ?? false} className="accent-ink" />
          Unsubscribed
        </label>
      </div>
      <div>
        <label className="label" htmlFor="streetAddress">
          Street address
        </label>
        <input id="streetAddress" name="streetAddress" defaultValue={c?.streetAddress ?? ""} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} className="input" />
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
