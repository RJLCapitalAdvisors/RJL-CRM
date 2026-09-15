import { addUserAction, sendInviteAction } from "@/app/settings/access-actions";
import { parseWorkspaces, type Workspace } from "@/lib/access";
import { fmtDate } from "@/lib/format";

type U = { id: string; name: string; email: string | null; active: boolean; workspaces: string; israelEmail: string | null; invitedAt: Date | null; lastSignInAt: Date | null };

/**
 * The users of one side, as plain as it gets: who they are, their email, whether they use the CRM, and one button
 * to send (or resend) the invite. The email's domain decides which business opens, so nothing to tick or save.
 * Adding a person just adds them; the invite goes from their row. The Israel page carries no business name because
 * RJL Israel and LiviemIsrael use it together.
 */
export function UsersCard({ users, workspace, canEdit }: { users: U[]; workspace: Workspace; canEdit: boolean }) {
  const ca = workspace === "CA";
  const rows = users.filter((u) => u.active && (parseWorkspaces(u.workspaces, u.email).includes(workspace) || (!ca && u.israelEmail)));
  // on the Israel page a person is listed by the address they open it with
  const emailFor = (u: U) => (ca ? u.email : u.israelEmail ?? u.email);
  const status = (u: U) => (u.lastSignInAt ? { text: `Using the CRM, last in ${fmtDate(u.lastSignInAt)}`, tone: "text-emerald-700" } : u.invitedAt ? { text: `Invited ${fmtDate(u.invitedAt)}, not in yet`, tone: "text-amber-700" } : { text: "Not invited", tone: "text-muted" });
  return (
    <div id="users" className="card">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-cream px-5 py-3">
        <div className="font-semibold">Users</div>
        <div className="text-sm text-muted">{canEdit ? "Add a person by email, then send the invite from their row." : "Only Jonathan can add people."}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>Person</th>
              <th>Email</th>
              {ca && <th>Israel side</th>}
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={ca ? 5 : 4} className="px-4 py-6 text-center text-muted">
                  Nobody yet.
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const st = status(u);
              return (
                <tr key={u.id}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-xs text-muted">{emailFor(u)}</td>
                  {ca && <td className="text-xs text-muted">{u.israelEmail ?? ""}</td>}
                  <td className={`text-xs ${st.tone}`}>{st.text}</td>
                  <td className="text-right">
                    {canEdit && u.email && (
                      <form action={sendInviteAction.bind(null, u.id, workspace)}>
                        <button type="submit" className="btn-grey px-2.5 py-1 text-xs" title={`Email ${u.email} the sign-in link`}>
                          {u.invitedAt || u.lastSignInAt ? "Invite again" : "Send invite"}
                        </button>
                      </form>
                    )}
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
            <div className="label">Add a person</div>
            <input name="name" placeholder="Full name" className="input w-48" />
          </div>
          <input name="email" type="email" placeholder={ca ? "name@rjlcapadvisors.com" : "name@rjlisrael.com or name@liviemisrael.com"} className="input w-80" required />
          <button type="submit" className="btn-primary">
            Add
          </button>
          <span className="w-full text-xs text-muted">{ca ? "Only @rjlcapadvisors.com addresses here. Once added, send the invite from their row." : "Anyone at @rjlisrael.com or @liviemisrael.com. Once added, send the invite from their row."}</span>
        </form>
      )}
    </div>
  );
}
