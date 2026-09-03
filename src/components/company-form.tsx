import { ROLES, US_STATES, parseList } from "@/lib/taxonomy";

type CompanyLike = {
  name: string;
  roles: string;
  website: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  yearFounded: number | null;
  notes: string | null;
  ownerId: string | null;
} | null;

export function CompanyForm({
  company,
  users,
  action,
  submitLabel = "Save",
}: {
  company: CompanyLike;
  users: { id: string; name: string }[];
  action: (fd: FormData) => void | Promise<void>;
  submitLabel?: string;
}) {
  const c = company;
  const roles = parseList(c?.roles);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="label" htmlFor="name">
            Company name
          </label>
          <input id="name" name="name" required defaultValue={c?.name ?? ""} className="input" />
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
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2">
          <label className="label" htmlFor="streetAddress">
            Street address
          </label>
          <input id="streetAddress" name="streetAddress" defaultValue={c?.streetAddress ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="city">
            City
          </label>
          <input id="city" name="city" defaultValue={c?.city ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="state">
            State
          </label>
          <select id="state" name="state" defaultValue={c?.state ?? ""} className="input">
            <option value="">—</option>
            {Object.entries(US_STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2">
          <label className="label" htmlFor="website">
            Website
          </label>
          <input id="website" name="website" defaultValue={c?.website ?? ""} className="input" placeholder="https://" />
        </div>
        <div>
          <label className="label" htmlFor="yearFounded">
            Year founded
          </label>
          <input id="yearFounded" name="yearFounded" inputMode="numeric" defaultValue={c?.yearFounded ?? ""} className="input" />
        </div>
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
