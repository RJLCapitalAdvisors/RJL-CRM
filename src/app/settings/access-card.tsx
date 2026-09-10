import { addUserAction, updateUserAccessAction } from "./access-actions";
import { parseWorkspaces } from "@/lib/access";

type U = { id: string; name: string; email: string | null; active: boolean; workspaces: string; israelEmail: string | null };

/**
 * People and access (Jonathan only). Each person opens RJL Capital Advisors, RJL Israel, or both. The RJL Israel
 * mailbox is the @rjlisrael.com address the CRM will read for that person once the Israel tenant is connected.
 */
export function AccessCard({ users }: { users: U[] }) {
  return (
    <div id="access" className="card">
      <div className="flex items-center justify-between border-b border-line bg-cream px-5 py-3">
        <div className="font-semibold">People and access</div>
        <div className="text-sm text-muted">Each side opens with its own account: an @rjlcapadvisors.com sign-in for RJL Capital Advisors, an @rjlisrael.com sign-in for RJL Israel. The boxes are what a person is allowed to open</div>
      </div>
      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>Person</th>
              <th>Sign-in email</th>
              <th className="text-center">RJL Capital Advisors</th>
              <th className="text-center">RJL Israel</th>
              <th>RJL Israel mailbox</th>
              <th className="text-center">Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const ws = parseWorkspaces(u.workspaces, u.email);
              return (
                <tr key={u.id}>
                  <td colSpan={7} className="p-0">
                    <form action={updateUserAccessAction.bind(null, u.id)} className="grid grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr_1.6fr_0.5fr_auto] items-center gap-2 px-3 py-2">
                      <span className="truncate font-medium">{u.name}</span>
                      <span className="truncate text-xs text-muted">{u.email}</span>
                      <span className="text-center">
                        <input type="checkbox" name="workspaces" value="CA" defaultChecked={ws.includes("CA")} className="accent-ink" />
                      </span>
                      <span className="text-center">
                        <input type="checkbox" name="workspaces" value="IL" defaultChecked={ws.includes("IL")} className="accent-ink" />
                      </span>
                      <input name="israelEmail" defaultValue={u.israelEmail ?? ""} placeholder="name@rjlisrael.com" className="input py-1 text-xs" />
                      <span className="text-center">
                        <input type="checkbox" name="active" defaultChecked={u.active} className="accent-ink" />
                      </span>
                      <button type="submit" className="btn-secondary px-2.5 py-1 text-xs">
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form action={addUserAction} className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-3 text-sm">
        <div>
          <div className="label">Add a person</div>
          <input name="name" placeholder="Full name" className="input w-44" required />
        </div>
        <input name="email" type="email" placeholder="sign-in email" className="input w-56" required />
        <input name="israelEmail" type="email" placeholder="RJL Israel mailbox (optional)" className="input w-56" />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="workspaces" value="CA" className="accent-ink" /> RJL CA
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="workspaces" value="IL" className="accent-ink" /> RJL Israel
        </label>
        <button type="submit" className="btn-primary">
          Add
        </button>
        <span className="w-full text-xs text-muted">Leave both boxes empty and the sign-in email decides. A person with both businesses signs in twice, once with each account.</span>
      </form>
    </div>
  );
}
