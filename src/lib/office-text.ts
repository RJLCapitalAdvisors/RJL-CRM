import { unzipSync, strFromU8 } from "fflate";

/**
 * Text out of a PowerPoint or Word file (Certes' teaser was a .pptx and never reached the extractor; Sep 28, 2026).
 * Both are zips of XML: the slides' <a:t> runs, the document's <w:t> runs, in order. Pictures and charts are skipped.
 */
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

export function pptxToText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const slides = Object.keys(files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const notes = (k: string) => `ppt/notesSlides/notesSlide${k.match(/(\d+)\.xml$/)![1]}.xml`;
  const out: string[] = [];
  for (const k of slides) {
    const xml = strFromU8(files[k]);
    // a paragraph per <a:p>, runs joined inside it
    const paras = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((m) => [...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decode(t[1])).join("")).map((p) => p.trim()).filter(Boolean);
    if (!paras.length) continue;
    out.push(`--- Slide ${k.match(/(\d+)\.xml$/)![1]} ---\n${paras.join("\n")}`);
    const n = files[notes(k)];
    if (n) {
      const noteText = [...strFromU8(n).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decode(t[1])).join(" ").trim();
      if (noteText && !/^\d+$/.test(noteText)) out.push(`(notes: ${noteText})`);
    }
  }
  return out.join("\n\n");
}

export function docxToText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const xml = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((m) => [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decode(t[1])).join(""))
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n");
}
