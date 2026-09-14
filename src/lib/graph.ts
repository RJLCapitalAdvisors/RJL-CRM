/**
 * Microsoft Graph (application permissions) for the team's mailboxes.
 * Env: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET. Messages are addressed with immutable ids
 * so a draft keeps its id after it is sent and moves to Sent Items.
 */

/**
 * Two tenants: RJL Capital Advisors (AZURE_*) and, once Jonathan connects it, RJL Israel (ISRAEL_AZURE_*). A call
 * that names an @rjlisrael.com mailbox goes to the Israel tenant when its credentials exist; everything else, and
 * the Israel mailbox before then, goes to the main tenant.
 */
export type Realm = "CA" | "IL";
const cache: Record<Realm, { token: string; exp: number } | null> = { CA: null, IL: null };
const creds = (realm: Realm) => (realm === "IL" && process.env.ISRAEL_AZURE_TENANT_ID ? { tenant: process.env.ISRAEL_AZURE_TENANT_ID, id: process.env.ISRAEL_AZURE_CLIENT_ID!, secret: process.env.ISRAEL_AZURE_CLIENT_SECRET! } : { tenant: process.env.AZURE_TENANT_ID!, id: process.env.AZURE_CLIENT_ID!, secret: process.env.AZURE_CLIENT_SECRET! });

export const graphConfigured = () => Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
export const israelGraphConfigured = () => Boolean(process.env.ISRAEL_AZURE_TENANT_ID && process.env.ISRAEL_AZURE_CLIENT_ID && process.env.ISRAEL_AZURE_CLIENT_SECRET);
const ISRAEL_DOMAIN = (process.env.ISRAEL_DEALS_MAILBOX?.split("@")[1] ?? "rjlisrael.com").toLowerCase();
/** The realm a Graph path belongs to: /users/<mailbox> on the Israel domain is the Israel tenant. */
export const realmFor = (path: string): Realm => (israelGraphConfigured() && new RegExp(`/users/[^/]*(?:@|%40)${ISRAEL_DOMAIN.replace(/\./g, "\\.")}(?:/|\\?|$)`, "i").test(path) ? "IL" : "CA");

export async function graphToken(realm: Realm = "CA"): Promise<string> {
  const c = cache[realm];
  if (c && c.exp > Date.now() + 60_000) return c.token;
  const { tenant, id, secret } = creds(realm);
  const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", body });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(`Graph token failed (${realm}): ${j.error_description ?? res.status}`);
  cache[realm] = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export async function graph<T = unknown>(path: string, init: RequestInit & { raw?: boolean; realm?: Realm } = {}): Promise<T> {
  const token = await graphToken(init.realm ?? realmFor(path));
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId"', ...(init.body && !(init.body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  if (init.raw) return (await res.arrayBuffer()) as T;
  const text = await res.text(); // 202 Accepted / 204 No Content carry no body
  return (text ? JSON.parse(text) : undefined) as T;
}

export type GraphMessage = {
  id: string;
  subject: string | null;
  conversationId?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
  isDraft?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  internetMessageId?: string;
  lastModifiedDateTime?: string;
  body?: { contentType: "html" | "text"; content: string };
  from?: { emailAddress: { address: string; name?: string } };
  toRecipients?: { emailAddress: { address: string; name?: string } }[];
  ccRecipients?: { emailAddress: { address: string; name?: string } }[];
};

export type GraphAttachment = { "@odata.type": string; id: string; name: string; contentType: string | null; size: number; isInline: boolean; contentBytes?: string };

const q = (s: string) => encodeURIComponent(s);

/** Most recent messages in a mailbox's Sent Items addressed to `toEmail` (newest first). */
export async function sentMessagesTo(mailbox: string, toEmail: string, top = 10): Promise<GraphMessage[]> {
  const r = await graph<{ value: GraphMessage[] }>(`/users/${q(mailbox)}/mailFolders/sentitems/messages?$search=${q(`"recipients:${toEmail}"`)}&$top=${top}&$select=id,subject,conversationId,sentDateTime,hasAttachments,toRecipients,ccRecipients,webLink,internetMessageId`);
  return [...r.value].sort((a, b) => (b.sentDateTime ?? "").localeCompare(a.sentDateTime ?? ""));
}

export async function getMessage(mailbox: string, id: string, select = "id,subject,isDraft,sentDateTime,webLink,body,conversationId"): Promise<GraphMessage> {
  return graph<GraphMessage>(`/users/${q(mailbox)}/messages/${q(id)}?$select=${select}`);
}

export async function listAttachments(mailbox: string, messageId: string): Promise<GraphAttachment[]> {
  const r = await graph<{ value: GraphAttachment[] }>(`/users/${q(mailbox)}/messages/${q(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
  return r.value;
}

/** Copy a file attachment from one message to another (small ones inline, big ones via an upload session). */
export async function copyAttachment(mailbox: string, fromMessageId: string, att: GraphAttachment, toMessageId: string) {
  if (att["@odata.type"] !== "#microsoft.graph.fileAttachment") return false;
  const bytes = await graph<ArrayBuffer>(`/users/${q(mailbox)}/messages/${q(fromMessageId)}/attachments/${q(att.id)}/$value`, { raw: true });
  const buf = new Uint8Array(bytes);
  if (buf.byteLength < 3 * 1024 * 1024) {
    await graph(`/users/${q(mailbox)}/messages/${q(toMessageId)}/attachments`, {
      method: "POST",
      body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name: att.name, contentType: att.contentType ?? "application/octet-stream", contentBytes: Buffer.from(buf).toString("base64") }),
    });
    return true;
  }
  const session = await graph<{ uploadUrl: string }>(`/users/${q(mailbox)}/messages/${q(toMessageId)}/attachments/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: att.name, size: buf.byteLength } }),
  });
  const CHUNK = 4 * 1024 * 1024;
  for (let start = 0; start < buf.byteLength; start += CHUNK) {
    const end = Math.min(start + CHUNK, buf.byteLength);
    const res = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${buf.byteLength}` }, body: buf.slice(start, end) });
    if (!res.ok && res.status !== 201 && res.status !== 200) throw new Error(`upload chunk failed: ${res.status}`);
  }
  return true;
}

/** Create a reply-all draft to a message; returns the draft (with body and webLink). */
export async function createReplyAllDraft(mailbox: string, messageId: string): Promise<GraphMessage> {
  return graph<GraphMessage>(`/users/${q(mailbox)}/messages/${q(messageId)}/createReplyAll`, { method: "POST", body: JSON.stringify({}) });
}

/** Hidden characters (zero-width spaces left by an old template) are a spam-filter tell; subjects go out clean. */
export const cleanSubject = (s: string) => s.replace(/[​-‍﻿⁠]/g, "").replace(/s{2,}/g, " ").trim();

export async function createDraft(mailbox: string, msg: { subject: string; toRecipients: string[]; ccRecipients?: string[]; bodyHtml: string }): Promise<GraphMessage> {
  return graph<GraphMessage>(`/users/${q(mailbox)}/messages`, {
    method: "POST",
    body: JSON.stringify({ subject: cleanSubject(msg.subject), body: { contentType: "html", content: msg.bodyHtml }, toRecipients: msg.toRecipients.map((address) => ({ emailAddress: { address } })), ...(msg.ccRecipients?.length ? { ccRecipients: msg.ccRecipients.map((address) => ({ emailAddress: { address } })) } : {}) }),
  });
}

export async function updateDraftBody(mailbox: string, messageId: string, html: string) {
  await graph(`/users/${q(mailbox)}/messages/${q(messageId)}`, { method: "PATCH", body: JSON.stringify({ body: { contentType: "html", content: html } }) });
}

/** Latest non-draft messages in Sent Items, for signature detection and email logging. */
export async function recentSent(mailbox: string, top = 5): Promise<GraphMessage[]> {
  const r = await graph<{ value: GraphMessage[] }>(`/users/${q(mailbox)}/mailFolders/sentitems/messages?$top=${top}&$orderby=sentDateTime desc&$select=id,subject,sentDateTime,body,toRecipients`);
  return r.value;
}

/** Classic desktop Outlook opens items by MAPI entry id via the outlook: protocol; convert our immutable id to one. */
export async function outlookDesktopLink(mailbox: string, messageId: string): Promise<string | null> {
  try {
    const r = await graph<{ value: { sourceId: string; targetId: string }[] }>(`/users/${q(mailbox)}/translateExchangeIds`, {
      method: "POST",
      body: JSON.stringify({ inputIds: [messageId], sourceIdType: "restImmutableEntryId", targetIdType: "entryId" }),
    });
    const entryId = r.value?.[0]?.targetId;
    // the outlook: protocol wants the MAPI entry id as upper-case hex; Graph hands it back base64-encoded
    return entryId ? `outlook:${Buffer.from(entryId, "base64").toString("hex").toUpperCase()}` : null;
  } catch {
    return null;
  }
}

/** Sent Items messages that involve anyone at a domain (newest first); pair with a subject filter to find a deal email. */
export async function sentMessagesToDomain(mailbox: string, domain: string, top = 25): Promise<GraphMessage[]> {
  const kw = domain.split(".")[0]; // KQL participants: matches on a keyword, not a dotted domain
  const r = await graph<{ value: GraphMessage[] }>(`/users/${q(mailbox)}/mailFolders/sentitems/messages?$search=${q(`"participants:${kw}"`)}&$top=${top}&$select=id,subject,conversationId,sentDateTime,hasAttachments,toRecipients,ccRecipients,webLink`);
  return [...r.value].sort((a, b) => (b.sentDateTime ?? "").localeCompare(a.sentDateTime ?? ""));
}

/** Attach bytes to a message: small files inline, big ones through an upload session (Graph's 3 MB rule). */
export async function addAttachment(mailbox: string, messageId: string, file: { name: string; contentType: string; bytes: Uint8Array }) {
  const { name, contentType, bytes } = file;
  if (bytes.byteLength < 3 * 1024 * 1024) {
    await graph(`/users/${q(mailbox)}/messages/${q(messageId)}/attachments`, { method: "POST", body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name, contentType, contentBytes: Buffer.from(bytes).toString("base64") }) });
    return;
  }
  const session = await graph<{ uploadUrl: string }>(`/users/${q(mailbox)}/messages/${q(messageId)}/attachments/createUploadSession`, { method: "POST", body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name, size: bytes.byteLength } }) });
  const CHUNK = 327_680 * 12; // Graph upload sessions want chunks in multiples of 320 KiB (a plain 4 MB chunk is rejected with 400)
  for (let s = 0; s < bytes.byteLength; s += CHUNK) {
    const e = Math.min(s + CHUNK, bytes.byteLength);
    const res = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Length": String(e - s), "Content-Range": `bytes ${s}-${e - 1}/${bytes.byteLength}`, "Content-Type": "application/octet-stream" }, body: bytes.slice(s, e) });
    if (!res.ok) throw new Error(`upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** A top-level mail folder by name, created if missing; returns its id. */
export async function ensureMailFolder(mailbox: string, displayName: string): Promise<string> {
  const r = await graph<{ value: { id: string; displayName: string }[] }>(`/users/${q(mailbox)}/mailFolders?$filter=displayName eq '${displayName.replace(/'/g, "''")}'&$select=id,displayName`);
  if (r.value[0]) return r.value[0].id;
  const made = await graph<{ id: string }>(`/users/${q(mailbox)}/mailFolders`, { method: "POST", body: JSON.stringify({ displayName }) });
  return made.id;
}
