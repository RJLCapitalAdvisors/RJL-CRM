import { addUserAction, removeUserAction, sendInviteAction, setMailReadAction } from "@/app/settings/access-actions";
import { InviteButton } from "@/components/invite-button";
import { MailReadToggle } from "@/components/mail-read-toggle";
import { RemoveUserButton } from "@/components/remove-user-button";
import { isCaMailbox, mailReadsFor, parseWorkspaces, type Workspace } from "@/lib/access";
import { fmtDate } from "@/lib/format";

type U = { id: string; name: string; email: string | null; active: boolean; workspaces: string; israelEmail: string | null; mailReads?: string | null; invitedAt: Date | null; lastSignInAt: Date | null; mailSyncedAt?: Date | null; acqMailSyncedAt?: Date | null; israelMailSyncedAt?: Date | null };

const NAMES: Record<Workspace, string> = { CA: "RJL Capital Advisors", IL: "RJL Israel", AQ: "RJL Acquisitions" };

/**
 * The users of one side, as plain as it gets: who they are, their email, whether they use the CRM, whether their
 * mailbox is read into THIS side (Email reading, Sep 18, 2026), and one button to send (or resend) the invite.
 * Email reading is a switch per side: a person's RJL CA mailbox feeds RJL Capital Advisors or RJL Acquisitions,
 * never both (Jonathan uses Acquisitions but his mail reads into RJL CA only); the Israel address feeds RJL Israel.
 * Adding a person just adds them; the invite goes from their row. The Israel page carries no business name because
 * RJL Israel and LiviemIsrael use it together.
 */
export function UsersCard({ users, workspace, canEdit, meId }: { users: U[]; workspace: Workspace; canEdit: boolean; meId?: string | null }) {
  const ca = workspace === "CA";
  const il = workspace === "IL";
  const rows = users.filter((u) => u.active && (parseWorkspaces(u.workspaces, u.email).includes(workspace) || (il && u.israelEmail)));
  // on the Israel page a person is listed by the address they open it with
  const emailFor = (u: U) => (il ? u.israelEmail ?? u.email : u.email);
  const status = (u: U) => (u.lastSignInAt ? { text: `Using the CRM, last in ${fmtDate(u.lastSignInAt)}`, tone: "text-emerald-700" } : u.invitedAt ? { text: `Invited ${fmtDate(u.invitedAt)}, not in yet`, tone: "text-amber-700" } : { text: "Not invited", tone: "text-muted" });
  // Email reading for this side: on, off, or not possible (no mailbox of the right kind)
  const reading = (u: U) => {
    const reads = mailReadsFor(u);
    const on = reads.includes(workspace);
    const lastRead = il ? u.israelMailSyncedAt : workspace === "AQ" ? u.acqMailSyncedAt : u.mailSyncedAt;
    if (il && !u.israelEmail) return { on: false, can: false, text: "No RJL Israel address on file" };
    if (!il && !isCaMailbox(u.email)) return { on: false, can: false, text: "No @rjlcapadvisors.com mailbox" };
    if (on) return { on: true, can: true, text: lastRead ? `On, last read ${fmtDate(lastRead)}` : "On, first read pending" };
    const elsewhere = il ? null : reads.find((r) => r === "CA" || r === "AQ");
    return { on: false, can: true, text: elsewhere ? `Off here; read into ${NAMES[elsewhere]}` : "Off" };
  };
  const addPlaceholder = il ? "name@rjlisrael.com or name@liviemisrael.com" : "name@rjlcapadvisors.com";
  const addHint = il ? "Anyone at @rjlisrael.com or @liviemisrael.com. Once added, send the invite from their row." : ca ? "Only @rjlcapadvisors.com addresses here. Once added, send the invite from their row." : "An @rjlcapadvisors.com address; adding it here opens RJL Acquisitions for that person. Their mailbox is read into this side only if you switch Email reading on for them here.";
  return (
    <div id="users" className="card">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-cream px-5 py-3">
        <div className="font-semibold">Users</div>
        <div className="text-sm text-muted">{canEdit ? "Add a person by email, then send the invite from their row. Email reading says whether their mailbox feeds this side's email log." : "Only Jonathan can add people or change email reading."}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>Person</th>
              <th>Email</th>
              {ca && <th>Israel side</th>}
              <th>Status</th>
              <th>Email reading</th>
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
            {rows.map((u) => {
              const st = status(u);
              const rd = reading(u);
              return (
                <tr key={u.id}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-xs text-muted">{emailFor(u)}</td>
                  {ca && <td className="text-xs text-muted">{u.israelEmail ?? ""}</td>}
                  <td className={`text-xs ${st.tone}`}>{st.text}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {rd.can && <MailReadToggle on={rd.on} action={setMailReadAction.bind(null, u.id, workspace)} disabled={!canEdit} />}
                      <span className={`text-xs ${rd.on ? "text-emerald-700" : "text-muted"}`}>{rd.text}</span>
                    </div>
                  </td>
                  <td className="text-right">
                    <div className="flex items-start justify-end gap-2">
                      {canEdit && u.email && (
                        <InviteButton action={sendInviteAction.bind(null, u.id, workspace)} label={u.invitedAt || u.lastSignInAt ? "Invite again" : "Send invite"} email={emailFor(u) ?? u.email} />
                      )}
                      {canEdit && <RemoveUserButton action={removeUserAction.bind(null, u.id)} name={u.name} self={u.id === meId} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form action={addUserAction} className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-3 text-sm">
          <input type="hidden" name="side" value={workspace} />
          <div>
            <div className="label">Add a person</div>
            <input name="name" placeholder="Full name" className="input w-48" />
          </div>
          <input name="email" type="email" placeholder={addPlaceholder} className="input w-80" required />
          <button type="submit" className="btn-primary">
            Add
          </button>
          <span className="w-full text-xs text-muted">{addHint}</span>
        </form>
      )}
    </div>
  );
}
