import { htmlToText } from "html-to-text";

/** Turn email bodies and attachments (PDF, Excel, text) into plain text the extractor can read. */

export function emailHtmlToText(html: string): string {
  return htmlToText(html, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" }] })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function attachmentToText(name: string, contentType: string | null, bytes: Uint8Array): Promise<string | null> {
  const lower = name.toLowerCase();
  const ct = (contentType ?? "").toLowerCase();
  try {
    if (lower.endsWith(".pdf") || ct.includes("pdf")) {
      const pdfParse = (await import("pdf-parse")).default as unknown as (b: Buffer) => Promise<{ text: string; numpages: number }>;
      const r = await pdfParse(Buffer.from(bytes));
      return r.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    if (/\.(xlsx|xlsm|xls|csv)$/.test(lower) || ct.includes("spreadsheet") || ct.includes("excel")) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(bytes, { type: "array", cellDates: true });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
        const lines = rows.map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c).trim())).join("\t").replace(/\t+$/, "")).filter((l) => l.replace(/\t/g, "").trim());
        if (!lines.length) continue;
        parts.push(`--- Sheet: ${sheetName} ---\n${lines.slice(0, 400).join("\n")}`);
      }
      return parts.join("\n\n");
    }
    if (lower.endsWith(".txt") || ct.startsWith("text/")) return new TextDecoder().decode(bytes);
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return emailHtmlToText(new TextDecoder().decode(bytes));
  } catch (e) {
    return `(could not read ${name}: ${String(e instanceof Error ? e.message : e).slice(0, 120)})`;
  }
  return null; // images, Word docs (not yet), zips
}

/** Keep the extractor input within reason: the email first, then attachments, biggest ones trimmed. */
export function assembleDealText(body: string, attachments: { name: string; text: string }[], cap = 140_000): string {
  let out = body.trim();
  const remaining = () => cap - out.length;
  for (const a of attachments) {
    if (remaining() < 2000) break;
    const slice = a.text.length > remaining() - 200 ? a.text.slice(0, remaining() - 200) + "\n…(truncated)" : a.text;
    out += `\n\n===== ATTACHMENT: ${a.name} =====\n${slice}`;
  }
  return out;
}
