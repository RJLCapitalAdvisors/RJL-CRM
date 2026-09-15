import { addUserAction, sendInviteAction, updateUserAccessAction } from "@/app/settings/access-actions";
import { parseWorkspaces, type Workspace } from "@/lib/access";
import { fmtDate } from "@/lib/format";

type U = { id: string; name: string; email: string | null; active: boolean; workspaces: string; israelEmail: string | null; invitedAt: Date | null; lastSignInAt: Date | null };

/**
 * Users of one business (Settings > Users in RJL Capital Advisors, Settings in RJL Israel). Jonathan sees everyone
 * who can open this side, ticks what each person opens, and adds a person by email; the invite email carries the
 * sign-in link and which Microsoft account to use. The status column says whether they have been in yet.
 */
export function UsersCard({ users, workspace, canEdit }: { users: U[]; workspace: Workspace; canEdit: boolean }) {
  const name = workspace === "IL" ? "RJL Israel" : "RJL Capital Advisors";
  const rows = users.filter((u) => parseWorkspaces(u.workspaces, u.email).includes(workspace) || (workspace === "IL" && u.israelEmail));
  // on the RJL Israel page a person is listed by the address they open RJL Israel with
  const signInFor = (u: U) => (workspace === "IL" ? u.israelEmail ?? u.email : u.email);
  const status = (u: U) => (u.lastSignInAt ? `Signed in ${fmtDate(u.lastSignInAt)}` : u.invitedAt ? `Invited ${fmtDate(u.invitedAt)}, not in yet` : "Not invited yet");
  return (
    <div id="users" className="card">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-cream px-5 py-3">
        <div className="font-semibold">Users of {name}</div>
        <div className="text-sm text-muted">{canEdit ? "Tick what each person opens. Add a person by email and the invite goes out with the sign-in link." : "Only Jonathan can add people or change access."}</div>
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
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted">
                  Nobody opens {name} yet.
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const ws = parseWorkspaces(u.workspaces, u.email);
              return (
                <tr key={u.id}>
                  <td colSpan={8} className="p-0">
                    <form action={updateUserAccessAction.bind(null, u.id)} className="grid grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr_1.5fr_0.5fr_1.3fr_auto] items-center gap-2 px-3 py-2">
                      <span className="truncate font-medium" title={u.name}>
                        {u.name}
                      </span>
                      <span className="truncate text-xs text-muted" title={signInFor(u) ?? ""}>
                        {signInFor(u)}
                      </span>
                      <span className="text-center">
                        <input type="checkbox" name="workspaces" value="CA" defaultChecked={ws.includes("CA")} disabled={!canEdit} className="accent-ink" />
                      </span>
                      <span className="text-center">
                        <input type="checkbox" name="workspaces" value="IL" defaultChecked={ws.includes("IL")} disabled={!canEdit} className="accent-ink" />
                      </span>
                      <input name="israelEmail" defaultValue={u.israelEmail ?? ""} placeholder="name@rjlisrael.com" disabled={!canEdit} className="input py-1 text-xs" />
                      <span className="text-center">
                        <input type="checkbox" name="active" defaultChecked={u.active} disabled={!canEdit} className="accent-ink" />
                      </span>
                      <span className={`text-xs ${u.lastSignInAt ? "text-emerald-700" : "text-muted"}`}>{status(u)}</span>
                      <span className="flex items-center gap-1">
                        {canEdit && (
                          <button type="submit" className="btn-secondary px-2.5 py-1 text-xs">
                            Save
                          </button>
                        )}
                        {canEdit && u.email && (
                          <button type="submit" formAction={sendInviteAction.bind(null, u.id, workspace)} className="btn-grey px-2.5 py-1 text-xs" title={`Email ${u.email} the ${name} sign-in link`}>
                            {u.invitedAt ? "Invite again" : "Send invite"}
                          </button>
                        )}
                      </span>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form action={addUserAction} className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-3 text-sm">
          <div>
            <div className="label">Add a person to {name}</div>
            <input name="name" placeholder="Full name" className="input w-44" />
          </div>
          <input name="email" type="email" placeholder={workspace === "IL" ? "name@rjlisrael.com" : "name@rjlcapadvisors.com"} className="input w-60" required />
          {workspace === "CA" && <input name="israelEmail" type="email" placeholder="RJL Israel mailbox (optional)" className="input w-56" />}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="workspaces" value="CA" defaultChecked={workspace === "CA"} className="accent-ink" /> RJL Capital Advisors
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="workspaces" value="IL" defaultChecked={workspace === "IL"} className="accent-ink" /> RJL Israel
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="invite" defaultChecked className="accent-ink" /> Send an invite
          </label>
          <button type="submit" className="btn-primary">
            Add
          </button>
          <span className="w-full text-xs text-muted">The invite email carries the sign-in link and which Microsoft account to use. Someone with both businesses signs in twice, once with each account. Only @rjlcapadvisors.com, @rjlisrael.com and the listed @liviemisrael.com people can be added for now.</span>
        </form>
      )}
    </div>
  );
}
