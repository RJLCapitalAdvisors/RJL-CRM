import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "fs/promises";
import path from "path";

/**
 * The request sheet the RJL Israel deals mailbox sends back (Jonathan, Oct 15, 2026): one page per project with its
 * apartments (or per batch of houses), on RJL Israel letterhead. Every item on the Required Items Lists appears once:
 * what is still needed in bold, what was found in regular weight, so bold plus regular is everything the list asks for.
 * An apartment item is needed when any unit type lacks it, and found only when every unit type has it.
 *
 * Open Sans (public/fonts, with Hebrew glyphs) is embedded, so a Hebrew project name draws; Hebrew runs are reversed
 * into visual order by hand, since the PDF has no bidi of its own. Without the font, Helvetica and Latin only.
 */

export type RequestItem = { label: string; value?: string | null; needed: boolean };
export type RequestSection = { heading: string; lead?: string[]; items: RequestItem[] };
export type RequestPage = { title: string; subtitle?: string | null; sections: RequestSection[] };
export type RequestMeta = { subject: string | null; from: string | null; date: Date };

const PAGE = { w: 612, h: 792, margin: 50 };
const FIRM = { name: "RJL Israel", web: "rjlisrael.com", email: process.env.ISRAEL_DEALS_MAILBOX ?? "deals@rjlisrael.com", address: process.env.ISRAEL_LETTERHEAD_ADDRESS ?? "" };

/** A file under public/: from disk locally, from the site when the function runs on Vercel. */
async function publicBytes(rel: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path.join(process.cwd(), "public", rel)));
  } catch {
    try {
      const base = (process.env.APP_URL ?? "https://rjl-crm.vercel.app").replace(/\/$/, "");
      const r = await fetch(`${base}/${rel}`, { signal: AbortSignal.timeout(8000) });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

const HEBREW = /[֐-׿]/;
/** Hebrew runs reversed into visual order; a line that is mostly Hebrew also has its runs reversed, numbers and Latin kept as they are. */
export function visual(s: string): string {
  if (!HEBREW.test(s)) return s;
  const runs = s.match(/[֐-׿][֐-׿\s'"׳״]*[֐-׿]|[֐-׿]|[^֐-׿]+/g) ?? [s];
  const flip = (t: string) => [...t].reverse().join("");
  const hebrewChars = (s.match(/[֐-׿]/g) ?? []).length, latinChars = (s.match(/[A-Za-z]/g) ?? []).length;
  const rtl = hebrewChars > latinChars;
  const out = runs.map((r) => (HEBREW.test(r) ? flip(r) : rtl ? flip(r.replace(/[()[\]{}]/g, (c) => ({ "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{" })[c] ?? c)) : r));
  return (rtl ? out.reverse() : out).join("");
}

/** Characters the font cannot draw are dropped, so one odd symbol never fails the whole page. */
function drawable(font: PDFFont, s: string): string {
  let out = "";
  for (const ch of s) {
    try {
      font.widthOfTextAtSize(ch, 10);
      out += ch;
    } catch {
      out += ch === " " ? " " : "";
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

/** A value cut to one line of the given width, with an ellipsis. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function requestFileName(stem: string) {
  return `${stem.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) || "Request"} - Needed.pdf`;
}

export async function buildIsraelRequestPdf(pages: RequestPage[], meta: RequestMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${FIRM.name} - what is needed`);
  doc.setAuthor(FIRM.name);
  let reg: PDFFont, bold: PDFFont, unicode = true;
  try {
    doc.registerFontkit(fontkit);
    const [r, b] = await Promise.all([publicBytes("fonts/OpenSans_400Regular.ttf"), publicBytes("fonts/OpenSans_700Bold.ttf")]);
    if (!r || !b) throw new Error("fonts missing");
    reg = await doc.embedFont(r, { subset: true });
    bold = await doc.embedFont(b, { subset: true });
  } catch (e) {
    console.error("israel request pdf: Open Sans not embedded, Latin only", String(e).slice(0, 120));
    unicode = false;
    reg = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  const text = (s: string) => (unicode ? visual(s) : s.replace(/[^\x20-\x7e -ÿ]/g, "")).replace(/\s+/g, " ").trim();
  const ink = rgb(0.1, 0.14, 0.13), muted = rgb(0.42, 0.44, 0.43), rule = rgb(0.85, 0.88, 0.9), navy = rgb(0.11, 0.2, 0.36);
  const width = PAGE.w - PAGE.margin * 2;
  const logo = await publicBytes("israel-logo.png");
  const logoImg = logo ? await doc.embedPng(logo).catch(() => null) : null;
  const dateLine = meta.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const letterhead = (p: PDFPage) => {
    const top = PAGE.h - 36;
    const logoH = 38;
    if (logoImg) p.drawImage(logoImg, { x: PAGE.margin, y: top - logoH, width: (logoImg.width / logoImg.height) * logoH, height: logoH });
    else p.drawText(FIRM.name, { x: PAGE.margin, y: top - 20, size: 16, font: bold, color: navy });
    const lines = [FIRM.name, FIRM.address, `${FIRM.web}  ·  ${FIRM.email}`].filter(Boolean);
    lines.forEach((l, i) => {
      const size = i === 0 ? 9.5 : 8;
      const f = i === 0 ? bold : reg;
      p.drawText(drawable(f, text(l)), { x: PAGE.w - PAGE.margin - f.widthOfTextAtSize(drawable(f, text(l)), size), y: top - 9 - i * 11, size, font: f, color: i === 0 ? ink : muted });
    });
    p.drawLine({ start: { x: PAGE.margin, y: top - logoH - 8 }, end: { x: PAGE.w - PAGE.margin, y: top - logoH - 8 }, thickness: 1, color: navy });
    return top - logoH - 8 - 18;
  };
  const footer = (p: PDFPage, n: number, total: number) => {
    p.drawLine({ start: { x: PAGE.margin, y: 36 }, end: { x: PAGE.w - PAGE.margin, y: 36 }, thickness: 0.5, color: rule });
    const left = drawable(reg, text(`${FIRM.name}  ·  ${meta.subject ? `re: ${meta.subject}` : ""}  ·  ${dateLine}`));
    p.drawText(fit(left, reg, 7.5, width - 80), { x: PAGE.margin, y: 24, size: 7.5, font: reg, color: muted });
    const right = `Page ${n} of ${total}`;
    p.drawText(right, { x: PAGE.w - PAGE.margin - reg.widthOfTextAtSize(right, 7.5), y: 24, size: 7.5, font: reg, color: muted });
  };

  /** Lay a page out at a size; returns the lines drawn (or needed) so the caller can pick the largest size that fits. */
  type Op = { kind: "text"; s: string; font: PDFFont; size: number; color: ReturnType<typeof rgb>; x: number; dy: number } | { kind: "gap"; dy: number } | { kind: "rule" };
  const plan = (pg: RequestPage, size: number): { ops: Op[]; height: number } => {
    const ops: Op[] = [];
    let h = 0;
    const lead = size * 1.32;
    const push = (s: string, font: PDFFont, color: ReturnType<typeof rgb>, x = 0, sz = size) => { ops.push({ kind: "text", s, font, size: sz, color, x, dy: sz * 1.32 }); h += sz * 1.32; };
    const gap = (dy: number) => { ops.push({ kind: "gap", dy }); h += dy; };
    // title block
    for (const l of wrap(drawable(bold, text(pg.title)), bold, 16, width)) push(l, bold, ink, 0, 16);
    if (pg.subtitle) push(fit(drawable(reg, text(pg.subtitle)), reg, 9, width), reg, muted, 0, 9);
    gap(4);
    ops.push({ kind: "rule" }); h += 8;
    push(fit(drawable(reg, text("Bold: still needed.  Regular: found in the email and its files.")), reg, 8.5, width), reg, muted, 0, 8.5);
    gap(6);
    for (const sec of pg.sections) {
      push(drawable(bold, text(sec.heading)), bold, navy, 0, size + 1);
      for (const l of sec.lead ?? []) push(fit(drawable(reg, text(l)), reg, size - 0.5, width), reg, muted, 0, size - 0.5);
      if (sec.lead?.length) gap(2);
      for (const it of sec.items) {
        const font = it.needed ? bold : reg;
        const label = drawable(font, text(it.label));
        const value = it.value ? drawable(reg, text(it.value)) : "";
        if (it.needed) {
          for (const l of wrap(`• ${label}`, bold, size, width)) push(l, bold, ink, 0);
        } else {
          const lab = fit(`• ${label}`, reg, size, width * 0.62);
          const w = reg.widthOfTextAtSize(`${lab}: `, size);
          ops.push({ kind: "text", s: `${lab}${value ? ":" : ""}`, font: reg, size, color: ink, x: 0, dy: 0 });
          if (value) ops.push({ kind: "text", s: fit(value, reg, size - 0.5, width - w), font: reg, size: size - 0.5, color: muted, x: w, dy: 0 });
          gap(lead);
        }
      }
      gap(7);
    }
    return { ops, height: h };
  };

  const total = pages.length;
  pages.forEach((pg, i) => {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    const startY = letterhead(page);
    const room = startY - 48;
    let size = 10, laid = plan(pg, size);
    while (laid.height > room && size > 7) { size -= 0.5; laid = plan(pg, size); }
    let y = startY;
    let overflow = false;
    for (const op of laid.ops) {
      if (op.kind === "rule") { page.drawLine({ start: { x: PAGE.margin, y: y - 3 }, end: { x: PAGE.w - PAGE.margin, y: y - 3 }, thickness: 0.5, color: rule }); y -= 8; continue; }
      if (op.kind === "gap") { y -= op.dy; continue; }
      if (y - op.size < 46) { overflow = true; break; }
      page.drawText(op.s, { x: PAGE.margin + op.x, y: y - op.size, size: op.size, font: op.font, color: op.color });
      y -= op.dy;
    }
    if (overflow) page.drawText("… more items than fit on one page: see the ticket in the CRM.", { x: PAGE.margin, y: 44, size: 8, font: reg, color: muted });
    footer(page, i + 1, total);
  });
  return doc.save();
}
