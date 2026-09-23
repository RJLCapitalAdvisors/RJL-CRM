/**
 * PDF pages as pictures (Sep 23, 2026). Developer decks are drawings with a few numbers on them: floor plans, a
 * compass rose, a unit table. Text extraction gets almost nothing and Claude's PDF reader refused the Mofet decks
 * outright ("Could not process PDF"), so each page is rendered here (MuPDF, WebAssembly, no native build) and sent
 * as an image. JPEG when the renderer offers it, PNG otherwise; width capped so a deck stays well under the request limit.
 */
export type PageImage = { page: number; bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" };

export async function renderPdfPages(bytes: Uint8Array, opts: { maxPages?: number; width?: number } = {}): Promise<PageImage[]> {
  const { maxPages = 40, width = 1200 } = opts;
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const n = Math.min(doc.countPages(), maxPages);
  const out: PageImage[] = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const [x0, , x1] = page.getBounds();
    const scale = Math.min(2, width / Math.max(1, x1 - x0));
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    let img: PageImage;
    const withJpeg = pix as unknown as { asJPEG?: (quality: number, invert: boolean) => Uint8Array };
    if (typeof withJpeg.asJPEG === "function") img = { page: i + 1, bytes: withJpeg.asJPEG(82, false), mediaType: "image/jpeg" };
    else img = { page: i + 1, bytes: pix.asPNG(), mediaType: "image/png" };
    pix.destroy();
    page.destroy();
    out.push(img);
  }
  doc.destroy();
  return out;
}

export function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return import("mupdf").then((mupdf) => {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const n = doc.countPages();
    doc.destroy();
    return n;
  });
}
