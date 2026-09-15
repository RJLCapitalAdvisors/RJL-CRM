import { addUserAction, sendInviteAction, updateUserAccessAction } from "@/app/settings/access-actions";
import { parseWorkspaces, type Workspace } from "@/lib/access";
import { fmtDate } from "@/lib/format";

type U = { id: string; name: string; email: string | null; active: boolean; workspaces: string; israelEmail: string | null; invitedAt: Date | null; lastSignInAt: Date | null };

/**
 * The users of one side. Kept simple: a person, their email, whether they are active, and whether they have been in
 * yet. The email's domain decides which business opens (an @rjlcapadvisors.com address opens RJL Capital Advisors;
 * @rjlisrael.com and @liviemisrael.com open the Israel side), so there is nothing to tick. Adding a person by email
 * sends the invite with the sign-in link. The Israel page carries no business name: RJL Israel and LiviemIsrael use
 * it together.
 */
export function UsersCard({ users, workspace, canEdit }: { users: U[]; workspace: Workspace; canEdit: boolean }) {
  const ca = workspace === "CA";
  const rows = users.filter((u) => parseWorkspaces(u.workspaces, u.email).includes(workspace) || (!ca && u.israelEmail));
  // on the Israel page a person is listed by the address they open it with
  const emailFor = (u: U) => (ca ? u.email : u.israelEmail ?? u.email);
  const status = (u: U) => (u.lastSignInAt ? `Signed in ${fmtDate(u.lastSignInAt)}` : u.invitedAt ? `Invited ${fmtDate(u.invitedAt)}, not in yet` : "Not invited yet");
  const cols = ca ? "grid-cols-[1.3fr_1.8fr_1.6fr_0.5fr_1.4fr_auto]" : "grid-cols-[1.3fr_2fr_0.5fr_1.4fr_auto]";
  return (
    <div id="users" className="card">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-cream px-5 py-3">
        <div className="font-semibold">Users</div>
        <div className="text-sm text-muted">{canEdit ? "Add a person by email and the invite goes out with the sign-in link." : "Only Jonathan can add people."}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>Person</th>
              <th>Email</th>
              {ca && <th>Also opens the Israel side with</th>}
              <th className="text-center">Active</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={ca ? 6 : 5} className="px-4 py-6 text-center text-muted">
                  Nobody yet.
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id}>
                <td colSpan={ca ? 6 : 5} className="p-0">
                  <form action={updateUserAccessAction.bind(null, u.id)} className={`grid ${cols} items-center gap-2 px-3 py-2`}>
                    <span className="truncate font-medium" title={u.name}>
                      {u.name}
                    </span>
                    <span className="truncate text-xs text-muted" title={emailFor(u) ?? ""}>
                      {emailFor(u)}
                    </span>
                    {ca && <input name="israelEmail" defaultValue={u.israelEmail ?? ""} placeholder="name@rjlisrael.com (optional)" disabled={!canEdit} className="input py-1 text-xs" />}
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
                        <button type="submit" formAction={sendInviteAction.bind(null, u.id, workspace)} className="btn-grey px-2.5 py-1 text-xs" title={`Email ${u.email} the sign-in link`}>
                          {u.invitedAt ? "Invite again" : "Send invite"}
                        </button>
                      )}
                    </span>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form action={addUserAction} className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-3 text-sm">
          <div>
            <div className="label">Add a person</div>
            <input name="name" placeholder="Full name" className="input w-44" />
          </div>
          <input name="email" type="email" placeholder={ca ? "name@rjlcapadvisors.com" : "name@rjlisrael.com or name@liviemisrael.com"} className="input w-72" required />
          {ca && <input name="israelEmail" type="email" placeholder="Israel-side address (optional)" className="input w-56" />}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="invite" defaultChecked className="accent-ink" /> Send an invite
          </label>
          <button type="submit" className="btn-primary">
            Add
          </button>
          <span className="w-full text-xs text-muted">{ca ? "An @rjlcapadvisors.com address opens RJL Capital Advisors. Fill in the Israel-side address for someone who uses both." : "Anyone with an @rjlisrael.com or @liviemisrael.com address can be added. The email's domain is what opens the door; no other domains for now."}</span>
        </form>
      )}
    </div>
  );
}
