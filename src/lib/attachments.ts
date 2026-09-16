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
      // the package index runs a debug routine (reads a test PDF) when loaded outside CommonJS; the lib entry is the real parser
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      const r = await pdfParse(Buffer.from(bytes));
      return r.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    if (/\.(xlsx|xlsm|xls|csv)$/.test(lower) || ct.includes("spreadsheet") || ct.includes("excel")) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(bytes, { type: "array", cellDates: true });
      // Carderock, Sep 16: the model's Building Information block (year built, site size) never reached the extractor because
      // each sheet stopped at 400 rows and the monthly cash flows ate the budget. Sheets that carry the property's facts and
      // the assumptions go first, cash flows last, and a sheet is read whole (up to 3,000 rows); long runs of empty cells collapse.
      const SHEET_FIRST = /summary|assumption|input|overview|sources|uses|property|building|info|deal|acq|return|debt|loan|rent ?roll|unit ?mix/i;
      const SHEET_LAST = /cash ?flow|monthly|month|cf\b|schedule|amort|waterfall|calc/i;
      const rank = (n: string) => (SHEET_FIRST.test(n) && !SHEET_LAST.test(n) ? 0 : SHEET_LAST.test(n) ? 2 : 1);
      const names = [...wb.SheetNames].sort((a, b) => rank(a) - rank(b));
      const parts: string[] = [];
      for (const sheetName of names) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
        const lines = rows
          .map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c).trim())).join("\t").replace(/\t{3,}/g, "\t\t").replace(/\t+$/, ""))
          .filter((l) => l.replace(/\t/g, "").trim());
        if (!lines.length) continue;
        parts.push(`--- Sheet: ${sheetName} ---\n${lines.slice(0, 3000).join("\n")}${lines.length > 3000 ? "\n…(sheet continues)" : ""}`);
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
const isModelFile = (n: string) => /\.(xlsx|xlsm|xls|csv)$/i.test(n);

export function assembleDealText(body: string, attachmentsIn: { name: string; text: string }[], cap = 600_000): string {
  // Excel models first: they are the current numbers; the OM / deck is narrative and comes after
  const attachments = [...attachmentsIn].sort((x, y) => Number(isModelFile(y.name)) - Number(isModelFile(x.name)));
  const modelsFirst = attachments.some((x) => isModelFile(x.name));
  let out = body.trim() + (modelsFirst ? "\n\n[An Excel underwriting model is attached. Every number comes from the model; the PDF / OM is for the narrative and physical description. Where they disagree, the model wins and the difference is noted.]" : "");
  const remaining = () => cap - out.length;
  // models are read whole (they share up to 70% of the room when they would not all fit); the OMs and decks share what is left
  const models = attachments.filter((a) => isModelFile(a.name));
  const others = attachments.filter((a) => !isModelFile(a.name));
  const modelTotal = models.reduce((t, a) => t + a.text.length, 0);
  const modelRoom = Math.min(modelTotal, Math.floor(remaining() * 0.7));
  for (const a of models) {
    if (remaining() < 2000) break;
    const budget = Math.min(modelTotal > modelRoom ? Math.floor((modelRoom * a.text.length) / modelTotal) : a.text.length, remaining() - 200);
    const slice = a.text.length > budget ? a.text.slice(0, budget) + "\n…(truncated)" : a.text;
    out += `\n\n===== ATTACHMENT: ${a.name} =====\n${slice}`;
  }
  const share = others.length ? Math.max(15_000, Math.floor((remaining() - 400 * others.length) / others.length)) : 0;
  for (const a of others) {
    if (remaining() < 2000) break;
    const budget = Math.min(share, remaining() - 200);
    const slice = a.text.length > budget ? a.text.slice(0, budget) + "\n…(truncated)" : a.text;
    out += `\n\n===== ATTACHMENT: ${a.name} =====\n${slice}`;
  }
  return out;
}
