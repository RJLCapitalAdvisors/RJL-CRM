import { addAttachment, ensureMailFolder, graph, listAttachments, type GraphAttachment } from "@/lib/graph";

/**
 * Documents pulled from a Dropbox / Drive / OneDrive link are kept the same way email attachments are: on a
 * message in the deals@ mailbox, in a "CRM Files" folder. So downloads, the Attachments card and investor
 * emails all work off Graph, with no second trip to the link (a data room can be hundreds of MB).
 */

const MAILBOX = () => process.env.DEALS_MAILBOX ?? "deals@rjlcapadvisors.com";
const FOLDER = "CRM Files";
const q = encodeURIComponent;

export type Stashed = { mailbox: string; graphId: string; atts: GraphAttachment[] };

export async function stashFiles(files: { name: string; contentType: string | null; bytes: Uint8Array; url?: string; source?: string }[], label: string): Promise<Stashed | null> {
  if (!files.length) return null;
  const mb = MAILBOX();
  const folderId = await ensureMailFolder(mb, FOLDER);
  const lines = files.map((f) => `<li>${f.name} (${Math.round(f.bytes.byteLength / 1024)} KB)${f.source ? ` from ${f.source}` : ""}${f.url ? ` - <a href="${f.url}">${f.url}</a>` : ""}</li>`).join("");
  const draft = await graph<{ id: string }>(`/users/${q(mb)}/messages`, {
    method: "POST",
    body: JSON.stringify({ subject: `[CRM files] ${label}`, body: { contentType: "html", content: `<p>Files the CRM pulled from links in a deals@ email. Kept here so the deal ticket can serve and send them.</p><ul>${lines}</ul>` } }),
  });
  for (const f of files) await addAttachment(mb, draft.id, { name: f.name, contentType: f.contentType ?? "application/octet-stream", bytes: f.bytes });
  // out of Drafts, into the folder; the move hands back the message's new id
  const moved = await graph<{ id: string }>(`/users/${q(mb)}/messages/${q(draft.id)}/move`, { method: "POST", body: JSON.stringify({ destinationId: folderId }) }).catch(() => ({ id: draft.id }));
  const atts = (await listAttachments(mb, moved.id)).filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment");
  return { mailbox: mb, graphId: moved.id, atts };
}
