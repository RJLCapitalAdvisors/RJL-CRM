import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { loadReport } from "@/lib/tracker-report";
import { investorLabel, statusOf } from "@/lib/tracker";
import { logoBytes } from "@/lib/faq-pdf";

/**
 * The progress report as a real PDF, laid out like the Word reports Jonathan sends sponsors: logo,
 * "Progress Report", centered Deal Name / Deal Address / Prepared For, blue contact line, Notable Feedback
 * Themes, Items Needed from Sponsor, the black-bordered Investor | Status | Notes table with the status
 * colors, gray footer. Built on demand so it always reflects the report as it stands.
 */

const PAGE = { w: 612, h: 792, top: 48, bottom: 44, left: 60, right: 60 }; // US Letter, margins close to the Word file
const BLACK = rgb(0, 0, 0), GRAY = rgb(0.4, 0.4, 0.4), LIGHT = rgb(0.7, 0.7, 0.7), LINK = rgb(0.067, 0.333, 0.8), HEAD_BG = rgb(0.945, 0.953, 0.957);
const hex = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of (text ?? "").split(/\n+/)) {
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

export function progressReportFileName(dealName: string) {
  return `${dealName.replace(/[\\/:*?"<>|]+/g, "").trim()} - Progress Report.pdf`;
}

export async function buildProgressReportPdf(dealId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const report = await loadReport(dealId);
  if (!report) return null;
  const { deal, name, rows } = report;
  const cityState = [deal.city, deal.state].filter(Boolean).join(", ");
  const address = deal.propertyAddress && deal.city && deal.propertyAddress.toLowerCase().includes(deal.city.toLowerCase()) ? deal.propertyAddress : [deal.propertyAddress, cityState].filter(Boolean).join(", ");
  const themes = (deal.trackerThemes ?? "").split(/\n+/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const items = (deal.trackerItemsNote ?? "").split(/\n+/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

  const doc = await PDFDocument.create();
  doc.setTitle(`${name} - Progress Report`);
  doc.setAuthor("RJL Capital Advisors");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await logoBytes();
  const logoImg = logo ? await doc.embedPng(logo).catch(() => null) : null;
  const width = PAGE.w - PAGE.left - PAGE.right;

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.top;
  let pageNo = 1;
  const footer = (p: PDFPage) => {
    const f1 = "RJL Capital Advisors · 9 Park Place, 3rd Floor, Great Neck, NY 11021 · 516.220.0477";
    const f2 = `Confidential — For Authorized Recipients Only${pageNo > 1 || rows.length > 18 ? `   ·   Page ${pageNo}` : ""}`;
    p.drawText(f1, { x: (PAGE.w - reg.widthOfTextAtSize(f1, 8.5)) / 2, y: 30, size: 8.5, font: reg, color: GRAY });
    p.drawText(f2, { x: (PAGE.w - reg.widthOfTextAtSize(f2, 8.5)) / 2, y: 18, size: 8.5, font: reg, color: GRAY });
  };
  const newPage = () => {
    footer(page);
    page = doc.addPage([PAGE.w, PAGE.h]);
    pageNo++;
    y = PAGE.h - PAGE.top;
  };
  const centered = (text: string, size: number, font: PDFFont, color = BLACK) => {
    page.drawText(text, { x: (PAGE.w - font.widthOfTextAtSize(text, size)) / 2, y: y - size, size, font, color });
    y -= size + 4;
  };
  const labelValueCentered = (label: string, value: string, size = 10.5) => {
    const lw = bold.widthOfTextAtSize(label + " ", size);
    const vw = reg.widthOfTextAtSize(value, size);
    const x = (PAGE.w - lw - vw) / 2;
    page.drawText(label + " ", { x, y: y - size, size, font: bold, color: BLACK });
    page.drawText(value, { x: x + lw, y: y - size, size, font: reg, color: BLACK });
    y -= size + 5;
  };
  const rule = () => {
    page.drawLine({ start: { x: PAGE.left + 40, y: y - 6 }, end: { x: PAGE.w - PAGE.right - 40, y: y - 6 }, thickness: 0.6, color: LIGHT });
    y -= 16;
  };
  const section = (title: string, bullets: string[]) => {
    if (y - 60 < PAGE.bottom) newPage();
    y -= 8;
    page.drawText(title, { x: PAGE.left, y: y - 16, size: 15, font: bold, color: BLACK });
    y -= 26;
    for (const b of bullets) {
      const lines = wrap(b, reg, 10.5, width - 22);
      if (y - lines.length * 14 < PAGE.bottom) newPage();
      page.drawText("•", { x: PAGE.left + 8, y: y - 10.5, size: 10.5, font: reg, color: BLACK });
      for (const l of lines) {
        page.drawText(l, { x: PAGE.left + 22, y: y - 10.5, size: 10.5, font: reg, color: BLACK });
        y -= 14;
      }
      y -= 2;
    }
  };

  // header
  if (logoImg) {
    const h = 38;
    page.drawImage(logoImg, { x: PAGE.left, y: y - h, width: (logoImg.width / logoImg.height) * h, height: h });
    y -= h + 18;
  }
  centered("Progress Report", 16, bold);
  page.drawLine({ start: { x: PAGE.w / 2 - bold.widthOfTextAtSize("Progress Report", 16) / 2, y: y + 1 }, end: { x: PAGE.w / 2 + bold.widthOfTextAtSize("Progress Report", 16) / 2, y: y + 1 }, thickness: 0.8, color: BLACK });
  y -= 8;
  labelValueCentered("Deal Name:", name);
  labelValueCentered("Deal Address:", address || "NA");
  labelValueCentered("Prepared For:", deal.trackerPreparedFor || deal.sponsorName || "—");
  y -= 8;
  const contact = "Please email jonathan@rjlcapadvisors.com or aviel@rjlcapadvisors.com with any questions";
  page.drawText(contact, { x: PAGE.left, y: y - 10.5, size: 10.5, font: bold, color: LINK });
  y -= 18;

  if (themes.length || items.length) {
    if (themes.length) section("Notable Feedback Themes", themes);
    if (themes.length && items.length) rule();
    if (items.length) section("Items Needed from Sponsor", items);
  }

  // table
  const cols = [width * 0.32, width * 0.32, width * 0.36];
  const xs = [PAGE.left, PAGE.left + cols[0], PAGE.left + cols[0] + cols[1]];
  const pad = 6;
  const cell = (p: PDFPage, x: number, top: number, w: number, h: number, text: string[], font: PDFFont, bg?: ReturnType<typeof rgb>, color = BLACK) => {
    if (bg) p.drawRectangle({ x, y: top - h, width: w, height: h, color: bg, borderColor: BLACK, borderWidth: 0.8 });
    else p.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: BLACK, borderWidth: 0.8 });
    text.forEach((l, i) => p.drawText(l, { x: x + pad, y: top - pad - 9.5 - i * 12.5, size: 9.5, font, color }));
  };
  const headerRow = () => {
    const h = 24;
    if (y - h < PAGE.bottom) newPage();
    ["Investor", "Status", "Notes"].forEach((t, i) => cell(page, xs[i], y, cols[i], h, [t], bold, HEAD_BG));
    y -= h;
  };
  y -= 14;
  headerRow();
  for (const r of rows) {
    const st = statusOf(r.status);
    const a = wrap(investorLabel(r.contact), reg, 9.5, cols[0] - pad * 2);
    const b = wrap(st.label, reg, 9.5, cols[1] - pad * 2);
    const c = wrap(r.note ?? "", reg, 9.5, cols[2] - pad * 2);
    const h = Math.max(a.length, b.length, c.length) * 12.5 + pad * 2;
    if (y - h < PAGE.bottom) {
      newPage();
      headerRow();
    }
    cell(page, xs[0], y, cols[0], h, a, reg);
    cell(page, xs[1], y, cols[1], h, b, reg, hex(st.bg), hex(st.c));
    cell(page, xs[2], y, cols[2], h, c, reg);
    y -= h;
  }
  if (!rows.length) {
    const h = 24;
    cell(page, xs[0], y, width, h, ["No investors yet."], reg);
    y -= h;
  }
  footer(page);
  return { name: progressReportFileName(name), bytes: await doc.save() };
}
