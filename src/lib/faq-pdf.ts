import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/db";

/**
 * Investor FAQ: everything the sponsor has told us about a deal (the ticket's Questions answered),
 * laid out as a clean one-column PDF that rides along with the deal email.
 */

const PAGE = { w: 612, h: 792, margin: 56 }; // US Letter, 0.78in margins

function wrap(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
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
  return out;
}

export function faqFileName(dealName: string) {
  return `${dealName.replace(/[\\/:*?"<>|]+/g, "").trim()} - Investor FAQ.pdf`;
}

export async function buildFaqPdf(dealId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { facts: { orderBy: { createdAt: "asc" } } } });
  if (!deal || deal.facts.length === 0) return null;
  const name = deal.propertyName ?? deal.name;
  const doc = await PDFDocument.create();
  doc.setTitle(`${name} - Investor FAQ`);
  doc.setAuthor("RJL Capital Advisors");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.14, 0.13), muted = rgb(0.42, 0.44, 0.43), rule = rgb(0.87, 0.9, 0.93);
  const width = PAGE.w - PAGE.margin * 2;

  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const footer = (p: typeof page, n: number) => {
    p.drawLine({ start: { x: PAGE.margin, y: 40 }, end: { x: PAGE.w - PAGE.margin, y: 40 }, thickness: 0.5, color: rule });
    p.drawText("RJL Capital Advisors  ·  9 Park Place, 3rd Floor, Great Neck, NY 11021  ·  516.220.0477", { x: PAGE.margin, y: 28, size: 8, font: reg, color: muted });
    p.drawText(`Confidential  ·  Page ${n}`, { x: PAGE.w - PAGE.margin - reg.widthOfTextAtSize(`Confidential  ·  Page ${n}`, 8), y: 28, size: 8, font: reg, color: muted });
  };
  let pageNo = 1;
  const need = (h: number) => {
    if (y - h < 60) {
      footer(page, pageNo++);
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.margin;
    }
  };

  // header
  page.drawText(name, { x: PAGE.margin, y: y - 18, size: 18, font: bold, color: ink });
  y -= 24;
  const sub = [deal.sponsorName ? `Sponsor: ${deal.sponsorName}` : null, [deal.city, deal.state].filter(Boolean).join(", ") || null, `Investor FAQ  ·  ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`].filter(Boolean).join("   ·   ");
  page.drawText(sub, { x: PAGE.margin, y: y - 12, size: 9.5, font: reg, color: muted });
  y -= 22;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.w - PAGE.margin, y }, thickness: 1, color: ink });
  y -= 18;
  const intro = "Questions investors have asked about this opportunity, with the sponsor's answers, compiled by RJL Capital Advisors from the sponsor's materials and correspondence.";
  for (const l of wrap(intro, reg, 9.5, width)) {
    page.drawText(l, { x: PAGE.margin, y: y - 10, size: 9.5, font: reg, color: muted });
    y -= 13;
  }
  y -= 10;

  // Q&A
  deal.facts.forEach((f, i) => {
    const qLines = wrap(`${i + 1}. ${f.question}`, bold, 11, width);
    const aLines = wrap(f.answer, reg, 10.5, width - 14);
    need(qLines.length * 14 + aLines.length * 13.5 + 14);
    for (const l of qLines) {
      page.drawText(l, { x: PAGE.margin, y: y - 11, size: 11, font: bold, color: ink });
      y -= 14;
    }
    for (const l of aLines) {
      page.drawText(l, { x: PAGE.margin + 14, y: y - 10.5, size: 10.5, font: reg, color: ink });
      y -= 13.5;
    }
    y -= 12;
  });
  footer(page, pageNo);
  return { name: faqFileName(name), bytes: await doc.save() };
}
