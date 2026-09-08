import { createWriteStream } from "fs";
import { readFile, stat, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { unzipSync } from "fflate";
import yauzl from "yauzl";
import { graph, graphConfigured } from "@/lib/graph";

/**
 * Sponsors often send a Dropbox, Google Drive, OneDrive/SharePoint or Box link instead of attaching the OM
 * and model. When such a link reaches deals@, we open it, pull the documents down (a folder link yields all
 * of them) and treat them exactly like attachments: parsed for the ticket, listed under Attachments, sent on
 * to investors. Public / anyone-with-the-link shares only; anything that wants a sign-in is reported back.
 * Folder downloads (a whole data room can be a few hundred MB) stream to disk and are read entry by entry.
 */

export type CloudFile = { name: string; contentType: string | null; size: number; bytes: Uint8Array; url: string; source: "Dropbox" | "Google Drive" | "OneDrive" | "Box" };
export type CloudResult = { files: CloudFile[]; notes: string[] };

const MAX_FILE = 40 * 1024 * 1024; // one document
const MAX_TOTAL = 250 * 1024 * 1024; // all documents kept from one email
const MAX_ARCHIVE = 450 * 1024 * 1024; // a folder zip on disk
const MAX_FILES = 40;
const TIMEOUT = 25_000;
const ARCHIVE_TIMEOUT = 120_000;
const DOC = /\.(pdf|xlsx|xlsm|xls|csv|docx|doc|pptx|ppt|txt)$/i;
const HOST = /^https?:\/\/(?:[a-z0-9-]+\.)*(dropbox\.com|drive\.google\.com|docs\.google\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|box\.com)\//i;
const URL_RE = /https?:\/\/[^\s"'<>()\[\]]+/gi;

const unescapeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
function unwrapSafelink(u: string): string {
  try {
    const url = new URL(u);
    if (/safelinks\.protection\.outlook\.com$/i.test(url.hostname)) return url.searchParams.get("url") ?? u;
    if (/^www\.google\.com$/i.test(url.hostname) && url.pathname === "/url") return url.searchParams.get("q") ?? u;
  } catch {
    /* not a url */
  }
  return u;
}

/** Every cloud-storage link in the email (hrefs first, then bare URLs), Outlook safelinks unwrapped. */
export function findCloudLinks(html: string | null | undefined, text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const u = unwrapSafelink(unescapeHtml(raw).replace(/[.,;:!?]+$/, ""));
    if (!HOST.test(u)) return;
    const key = u.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  };
  for (const m of (html ?? "").matchAll(/href=["']([^"']+)["']/gi)) add(m[1]);
  for (const m of `${html ?? ""}\n${text ?? ""}`.matchAll(URL_RE)) add(m[0]);
  return out.slice(0, 10);
}

const fileNameFrom = (res: Response, fallback: string) => {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
};

const isHtml = (res: Response) => (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
const isZip = (res: Response, name: string) => /\.zip$/i.test(name) || (res.headers.get("content-type") ?? "").toLowerCase().includes("zip");
const UA = { "User-Agent": "Mozilla/5.0 (RJL CRM)" };

/** Small things in memory: a document, or an HTML page (a sign-in wall, a confirm form). */
async function download(url: string, init: RequestInit = {}): Promise<{ res: Response; bytes: Uint8Array } | { res: Response; html: string } | null> {
  const res = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT), headers: { ...UA, ...(init.headers ?? {}) } });
  if (!res.ok) return null;
  if (isHtml(res)) return { res, html: (await res.text()).slice(0, 400_000) };
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FILE) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FILE) return null;
  return { res, bytes: buf };
}

/** Big things to disk (folder zips): streamed, capped, cleaned up by the caller. */
async function downloadToDisk(url: string): Promise<{ res: Response; path: string; size: number; name: string } | { res: Response; html: string } | null> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(ARCHIVE_TIMEOUT), headers: UA });
  if (!res.ok || !res.body) return null;
  if (isHtml(res)) return { res, html: (await res.text()).slice(0, 400_000) };
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_ARCHIVE) return null;
  const file = path.join(os.tmpdir(), `rjlcrm-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  let written = 0;
  const cap = new (class extends (await import("stream")).Transform {
    _transform(chunk: Buffer, _enc: string, cb: (err?: Error | null, data?: Buffer) => void) {
      written += chunk.byteLength;
      if (written > MAX_ARCHIVE) return cb(new Error("archive too large"));
      cb(null, chunk);
    }
  })();
  try {
    await pipeline(Readable.fromWeb(res.body as never), cap, createWriteStream(file));
  } catch {
    await unlink(file).catch(() => {});
    return null;
  }
  return { res, path: file, size: (await stat(file)).size, name: fileNameFrom(res, "download.bin") };
}

const typeFor = (name: string, fromServer: string | null) => {
  const l = name.toLowerCase();
  if (l.endsWith(".pdf")) return "application/pdf";
  if (/\.(xlsx|xlsm)$/.test(l)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (l.endsWith(".xls")) return "application/vnd.ms-excel";
  if (l.endsWith(".csv")) return "text/csv";
  if (l.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (l.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return fromServer && !fromServer.includes("octet-stream") ? fromServer.split(";")[0] : "application/octet-stream";
};

const wanted = (entryPath: string, size: number) => DOC.test(entryPath) && !/__MACOSX|(^|\/)\./.test(entryPath) && size <= MAX_FILE && size > 0;

/** A small zip in memory (OneDrive folder fallback) becomes its documents. */
function unzipDocs(bytes: Uint8Array, url: string, source: CloudFile["source"]): CloudFile[] {
  const out: CloudFile[] = [];
  try {
    const entries = unzipSync(bytes, { filter: (f) => wanted(f.name, f.originalSize) });
    for (const [p, data] of Object.entries(entries)) {
      const name = p.split("/").pop()!;
      if (!name) continue;
      out.push({ name, contentType: typeFor(name, null), size: data.byteLength, bytes: data, url: `${url}#${encodeURIComponent(p)}`, source });
    }
  } catch {
    /* not a zip we can read */
  }
  return out;
}

/** A zip on disk (a whole data room) read entry by entry: only the documents, within the caps. */
function unzipDocsFromDisk(file: string, url: string, source: CloudFile["source"]): Promise<{ files: CloudFile[]; skipped: number }> {
  return new Promise((resolve) => {
    const files: CloudFile[] = [];
    let skipped = 0;
    let total = 0;
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve({ files, skipped });
      const finish = () => {
        try {
          zip.close();
        } catch {
          /* closed */
        }
        resolve({ files, skipped });
      };
      zip.on("error", finish);
      zip.on("end", finish);
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) return zip.readEntry();
        if (!wanted(entry.fileName, entry.uncompressedSize) || files.length >= MAX_FILES || total + entry.uncompressedSize > MAX_TOTAL) {
          if (DOC.test(entry.fileName)) skipped++;
          return zip.readEntry();
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) {
            skipped++;
            return zip.readEntry();
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("error", () => {
            skipped++;
            zip.readEntry();
          });
          stream.on("end", () => {
            const data = new Uint8Array(Buffer.concat(chunks));
            const name = entry.fileName.split("/").pop()!;
            total += data.byteLength;
            files.push({ name, contentType: typeFor(name, null), size: data.byteLength, bytes: data, url: `${url}#${encodeURIComponent(entry.fileName)}`, source });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** A file or folder link that answers with either a document or a zip: handled from disk so size does not matter. */
async function fetchDocumentOrArchive(url: string, source: CloudFile["source"], fallbackName: string): Promise<CloudResult | "html" | null> {
  const r = await downloadToDisk(url);
  if (!r) return null;
  if ("html" in r) return "html";
  try {
    const name = r.name === "download.bin" ? fallbackName : r.name;
    if (isZip(r.res, name)) {
      const { files, skipped } = await unzipDocsFromDisk(r.path, url, source);
      const notes: string[] = [];
      if (!files.length) notes.push(`${source} folder had no PDF / Excel / Word documents I could take: ${url}`);
      else if (skipped) notes.push(`${source} folder: kept ${files.length} document${files.length === 1 ? "" : "s"}, left ${skipped} out (over the size limit or past the first ${MAX_FILES}): ${url}`);
      return { files, notes };
    }
    if (!DOC.test(name) || r.size > MAX_FILE) return { files: [], notes: [] };
    const bytes = new Uint8Array(await readFile(r.path));
    return { files: [{ name, contentType: typeFor(name, r.res.headers.get("content-type")), size: bytes.byteLength, bytes, url, source }], notes: [] };
  } finally {
    await unlink(r.path).catch(() => {});
  }
}

// ---------- Dropbox ----------
async function dropbox(url: string): Promise<CloudResult> {
  const u = new URL(url);
  u.searchParams.set("dl", "1");
  const r = await fetchDocumentOrArchive(u.toString(), "Dropbox", u.pathname.split("/").pop() ?? "dropbox-file");
  if (!r) return { files: [], notes: [`Dropbox link could not be downloaded (too large, or not public): ${url}`] };
  if (r === "html") return { files: [], notes: [`Dropbox link needs a password or sign-in: ${url}`] };
  return r;
}

// ---------- Google Drive / Docs ----------
const gid = (url: string) => url.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([-\w]{15,})/)?.[1] ?? url.match(/[?&]id=([-\w]{15,})/)?.[1] ?? null;
const gfolder = (url: string) => url.match(/\/folders\/([-\w]{15,})/)?.[1] ?? null;
const GOOGLE_EXPORT: Record<string, { ext: string; mime: string }> = {
  "application/vnd.google-apps.spreadsheet": { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  "application/vnd.google-apps.document": { ext: ".pdf", mime: "application/pdf" },
  "application/vnd.google-apps.presentation": { ext: ".pdf", mime: "application/pdf" },
};

async function googleFile(id: string, url: string, hint?: string): Promise<CloudResult> {
  let r = await download(`https://drive.google.com/uc?export=download&id=${id}`);
  if (r && "html" in r) {
    // big files: Google shows a virus-scan page with a confirm form
    const form = r.html.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/i);
    const inputs = [...r.html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/gi)].map((m) => [m[1], unescapeHtml(m[2])]);
    if (form) {
      const target = new URL(unescapeHtml(form[1]));
      for (const [k, v] of inputs) target.searchParams.set(k, v);
      r = await download(target.toString());
    }
  }
  if (!r || "html" in r) return { files: [], notes: [`Google Drive file is not shared with "anyone with the link": ${url}`] };
  const name = fileNameFrom(r.res, hint ?? `google-drive-${id}.pdf`);
  if (!DOC.test(name)) return { files: [], notes: [] };
  return { files: [{ name, contentType: typeFor(name, r.res.headers.get("content-type")), size: r.bytes.byteLength, bytes: r.bytes, url, source: "Google Drive" }], notes: [] };
}

async function googleDocExport(url: string): Promise<CloudResult> {
  const id = gid(url);
  if (!id) return { files: [], notes: [] };
  const kind = url.includes("/spreadsheets/") ? "spreadsheets" : url.includes("/presentation/") ? "presentation" : "document";
  const exportUrl = kind === "spreadsheets" ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` : kind === "presentation" ? `https://docs.google.com/presentation/d/${id}/export/pdf` : `https://docs.google.com/document/d/${id}/export?format=pdf`;
  const r = await download(exportUrl);
  if (!r || "html" in r) return { files: [], notes: [`Google ${kind === "spreadsheets" ? "Sheet" : "Doc"} is not shared with "anyone with the link": ${url}`] };
  const name = fileNameFrom(r.res, `google-${kind}-${id}${kind === "spreadsheets" ? ".xlsx" : ".pdf"}`);
  return { files: [{ name, contentType: typeFor(name, r.res.headers.get("content-type")), size: r.bytes.byteLength, bytes: r.bytes, url, source: "Google Drive" }], notes: [] };
}

async function googleFolder(id: string, url: string): Promise<CloudResult> {
  const key = process.env.GOOGLE_API_KEY;
  const out: CloudResult = { files: [], notes: [] };
  if (key) {
    const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${id}' in parents and trashed = false`)}&fields=files(id,name,mimeType,size)&pageSize=100&key=${key}`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!list.ok) return { files: [], notes: [`Google Drive folder could not be listed (${list.status}); is it shared with "anyone with the link"? ${url}`] };
    const { files } = (await list.json()) as { files: { id: string; name: string; mimeType: string; size?: string }[] };
    for (const f of files) {
      if (out.files.length >= MAX_FILES) break;
      const exp = GOOGLE_EXPORT[f.mimeType];
      if (f.mimeType === "application/vnd.google-apps.folder") continue;
      if (!exp && !DOC.test(f.name)) continue;
      if (Number(f.size ?? 0) > MAX_FILE) continue;
      const dl = exp ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(exp.mime)}&key=${key}` : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${key}`;
      const r = await download(dl).catch(() => null);
      if (!r || "html" in r) continue;
      const name = exp ? f.name.replace(/\.[^.]+$/, "") + exp.ext : f.name;
      out.files.push({ name, contentType: exp?.mime ?? typeFor(name, r.res.headers.get("content-type")), size: r.bytes.byteLength, bytes: r.bytes, url: `https://drive.google.com/file/d/${f.id}/view`, source: "Google Drive" });
    }
    if (!out.files.length) out.notes.push(`Google Drive folder had no PDF / Excel / Word documents: ${url}`);
    return out;
  }
  // no API key: read the public folder page (best effort)
  const page = await download(`https://drive.google.com/drive/folders/${id}`).catch(() => null);
  if (page && "html" in page) {
    const decoded = page.html.replace(/\\x22/g, '"').replace(/\\x5b/g, "[").replace(/\\x5d/g, "]").replace(/\\\//g, "/").replace(/\\u0026/g, "&");
    const seen = new Set<string>();
    for (const m of decoded.matchAll(/"([-\w]{25,})",\["[-\w]{25,}"\],"([^"]{1,200})","([\w.+-]+\/[\w.+-]+)"/g)) {
      const [, fid, name, mime] = m;
      if (seen.has(fid) || out.files.length >= MAX_FILES) continue;
      seen.add(fid);
      const exp = GOOGLE_EXPORT[mime];
      if (exp) {
        const r = await googleDocExport(`https://docs.google.com/${mime.endsWith("spreadsheet") ? "spreadsheets" : mime.endsWith("presentation") ? "presentation" : "document"}/d/${fid}/edit`).catch(() => ({ files: [], notes: [] }));
        out.files.push(...r.files.map((f) => ({ ...f, name: name.replace(/\.[^.]+$/, "") + exp.ext })));
      } else if (DOC.test(name)) {
        const r = await googleFile(fid, `https://drive.google.com/file/d/${fid}/view`, name).catch(() => ({ files: [], notes: [] }));
        out.files.push(...r.files.map((f) => ({ ...f, name })));
      }
    }
  }
  if (!out.files.length) out.notes.push(`Google Drive folder could not be read without a Google API key (set GOOGLE_API_KEY): ${url}`);
  return out;
}

async function google(url: string): Promise<CloudResult> {
  const folder = gfolder(url);
  if (folder) return googleFolder(folder, url);
  if (/docs\.google\.com\/(spreadsheets|document|presentation)\//.test(url)) return googleDocExport(url);
  const id = gid(url);
  if (!id) return { files: [], notes: [] };
  return googleFile(id, url);
}

// ---------- OneDrive / SharePoint (through Graph's shares API; falls back to a direct download) ----------
type DriveItem = { id: string; name: string; size?: number; file?: { mimeType?: string }; folder?: unknown; "@microsoft.graph.downloadUrl"?: string };
async function onedrive(url: string): Promise<CloudResult> {
  const out: CloudResult = { files: [], notes: [] };
  if (graphConfigured()) {
    try {
      const shareId = "u!" + Buffer.from(url).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
      const item = await graph<DriveItem>(`/shares/${shareId}/driveItem`, { headers: { Prefer: "redeemSharingLink" } });
      const items: DriveItem[] = item.folder ? (await graph<{ value: DriveItem[] }>(`/shares/${shareId}/driveItem/children?$top=100`, { headers: { Prefer: "redeemSharingLink" } })).value : [item];
      for (const it of items) {
        if (out.files.length >= MAX_FILES || it.folder || !DOC.test(it.name) || (it.size ?? 0) > MAX_FILE) continue;
        const dl = it["@microsoft.graph.downloadUrl"];
        const r = dl ? await download(dl).catch(() => null) : null;
        if (!r || "html" in r) continue;
        out.files.push({ name: it.name, contentType: typeFor(it.name, it.file?.mimeType ?? null), size: r.bytes.byteLength, bytes: r.bytes, url, source: "OneDrive" });
      }
      if (out.files.length || item.folder) {
        if (!out.files.length) out.notes.push(`OneDrive folder had no PDF / Excel / Word documents: ${url}`);
        return out;
      }
    } catch {
      /* fall through to the direct download */
    }
  }
  const u = new URL(url);
  u.searchParams.set("download", "1");
  const r = await fetchDocumentOrArchive(u.toString(), "OneDrive", "onedrive-file.pdf").catch(() => null);
  if (!r) return { files: [], notes: [`OneDrive / SharePoint link could not be downloaded: ${url}`] };
  if (r === "html") return { files: [], notes: [`OneDrive / SharePoint link needs a sign-in or is not shared with anyone: ${url}`] };
  return r;
}

// ---------- Box ----------
async function box(url: string): Promise<CloudResult> {
  const hash = url.match(/\/s\/([\w]+)/)?.[1];
  if (!hash) return { files: [], notes: [] };
  const host = new URL(url).host;
  const r = await download(`https://${host}/shared/static/${hash}`).catch(() => null);
  if (!r || "html" in r) return { files: [], notes: [`Box link could not be downloaded directly (open it and attach the files, or ask the sponsor for a direct link): ${url}`] };
  const name = fileNameFrom(r.res, `box-${hash}.pdf`);
  if (!DOC.test(name)) return { files: [], notes: [] };
  if (/\.zip$/i.test(name)) return { files: unzipDocs(r.bytes, url, "Box"), notes: [] };
  return { files: [{ name, contentType: typeFor(name, r.res.headers.get("content-type")), size: r.bytes.byteLength, bytes: r.bytes, url, source: "Box" }], notes: [] };
}

/** Pull the documents behind every cloud link. Never throws; problems come back as notes for the reply. */
export async function fetchCloudFiles(urls: string[]): Promise<CloudResult> {
  const out: CloudResult = { files: [], notes: [] };
  let total = 0;
  for (const url of urls) {
    if (out.files.length >= MAX_FILES || total > MAX_TOTAL) break;
    let r: CloudResult;
    try {
      const host = new URL(url).hostname.toLowerCase();
      r = host.includes("dropbox.com") ? await dropbox(url) : host.includes("google.com") ? await google(url) : host.includes("box.com") ? await box(url) : await onedrive(url);
    } catch (e) {
      r = { files: [], notes: [`Could not open ${url}: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`] };
    }
    for (const f of r.files) {
      if (out.files.some((x) => x.name.toLowerCase() === f.name.toLowerCase() && x.size === f.size)) continue;
      if (total + f.size > MAX_TOTAL) continue;
      total += f.size;
      out.files.push(f);
    }
    out.notes.push(...r.notes);
  }
  return out;
}

/** Re-fetch one file recorded from a link (only for files recorded before they were kept in the deals@ mailbox). */
export async function fetchCloudFileByUrl(url: string, name: string): Promise<Uint8Array | null> {
  const base = url.replace(/#.*$/, "");
  const r = await fetchCloudFiles([base]);
  const hit = r.files.find((f) => f.name.toLowerCase() === name.toLowerCase()) ?? (r.files.length === 1 ? r.files[0] : null);
  return hit?.bytes ?? null;
}
