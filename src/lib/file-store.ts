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
const PER_MESSAGE = 20 * 1024 * 1024; // Exchange rejects a message whose attachments pass roughly 35 MB; stay well under

/** Keep the files on one or more messages in deals@ "CRM Files" (about 20 MB of attachments per message). */
export async function stashFiles(files: { name: string; contentType: string | null; bytes: Uint8Array; url?: string; source?: string }[], label: string): Promise<Stashed[]> {
  if (!files.length) return [];
  const mb = MAILBOX();
  const folderId = await ensureMailFolder(mb, FOLDER);
  // pack: big files alone, small ones together
  const batches: (typeof files)[] = [];
  let cur: typeof files = [];
  let size = 0;
  for (const f of [...files].sort((x, y) => y.bytes.byteLength - x.bytes.byteLength)) {
    if (cur.length && size + f.bytes.byteLength > PER_MESSAGE) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += f.bytes.byteLength;
  }
  if (cur.length) batches.push(cur);
  const out: Stashed[] = [];
  for (const [i, batch] of batches.entries()) {
    const lines = batch.map((f) => `<li>${f.name} (${Math.round(f.bytes.byteLength / 1024)} KB)${f.source ? ` from ${f.source}` : ""}${f.url ? ` - <a href="${f.url}">${f.url}</a>` : ""}</li>`).join("");
    const draft = await graph<{ id: string }>(`/users/${q(mb)}/messages`, {
      method: "POST",
      body: JSON.stringify({ subject: `[CRM files] ${label}${batches.length > 1 ? ` (${i + 1} of ${batches.length})` : ""}`, body: { contentType: "html", content: `<p>Files the CRM pulled from links in a deals@ email. Kept here so the deal ticket can serve and send them.</p><ul>${lines}</ul>` } }),
    });
    for (const f of batch) await addAttachment(mb, draft.id, { name: f.name, contentType: f.contentType ?? "application/octet-stream", bytes: f.bytes });
    // out of Drafts, into the folder; the move hands back the message's new id
    const moved = await graph<{ id: string }>(`/users/${q(mb)}/messages/${q(draft.id)}/move`, { method: "POST", body: JSON.stringify({ destinationId: folderId }) }).catch(() => ({ id: draft.id }));
    const atts = (await listAttachments(mb, moved.id)).filter((x) => x["@odata.type"] === "#microsoft.graph.fileAttachment");
    out.push({ mailbox: mb, graphId: moved.id, atts });
  }
  return out;
}
