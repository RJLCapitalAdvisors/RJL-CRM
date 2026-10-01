/**
 * A firm's email on the Send deal page is the General email plus that firm's own changes, kept as block edits
 * (Jonathan, Oct 1, 2026: an edit to the General email must reach every firm, including firms whose email was
 * edited on its own, and must stay there as he goes back and forth). Each edit remembers the General blocks it
 * replaced (as the firm saw them, name filled in) and what it put there. Rendering walks the General email block by
 * block: a run of blocks that still matches an edit's base is swapped for the edit's html, everything else is the
 * General text as it stands now. When the General email changes the very block a firm had edited, the General
 * change wins and that firm edit falls away. Client-safe (DOMParser when present; a tag-level splitter otherwise).
 */
export type BlockEdit = { base: string[]; html: string };
export type FirmDraft = { subject?: string; subjectBase?: string; edits: BlockEdit[]; touched: true; html?: string };

export type Split = { open: string; close: string; blocks: string[] };

/** The email's top-level blocks. A single wrapping element (the font div the renderer adds) is kept as open and close tags. */
export function splitBlocks(html: string): Split {
  if (typeof DOMParser === "undefined") return { open: "", close: "", blocks: [html] };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let root: Element = doc.body;
  let open = "", close = "";
  const meaningful = [...root.childNodes].filter((n) => n.nodeType === 1 || (n.textContent ?? "").trim());
  if (meaningful.length === 1 && meaningful[0].nodeType === 1 && (meaningful[0] as Element).tagName === "DIV") {
    root = meaningful[0] as Element;
    const outer = root.outerHTML;
    open = outer.slice(0, outer.indexOf(">") + 1);
    close = "</div>";
  }
  const blocks = [...root.childNodes].map((n) => (n.nodeType === 1 ? (n as Element).outerHTML : n.textContent ?? "")).filter((b) => b.trim());
  return { open, close, blocks };
}

/** The firm's blocks against the General blocks it was shown: runs that differ become edits (an empty base is text added at the end). */
export function diffBlocks(general: string[], firm: string[]): BlockEdit[] {
  const edits: BlockEdit[] = [];
  let i = 0, j = 0;
  while (i < general.length) {
    if (j < firm.length && firm[j] === general[i]) {
      i++;
      j++;
      continue;
    }
    let best: { i2: number; j2: number; cost: number } | null = null;
    for (let i2 = i; i2 < general.length; i2++) {
      const j2 = firm.indexOf(general[i2], j);
      if (j2 >= 0 && (!best || i2 - i + (j2 - j) < best.cost)) best = { i2, j2, cost: i2 - i + (j2 - j) };
    }
    const gi = best ? best.i2 : general.length;
    const fj = best ? best.j2 : firm.length;
    edits.push({ base: general.slice(i, gi), html: firm.slice(j, fj).join("") });
    i = gi;
    j = fj;
  }
  if (j < firm.length) edits.push({ base: [], html: firm.slice(j).join("") });
  return edits;
}

/** The General email (name filled in) with the firm's edits laid over the blocks that still match. */
export function applyEdits(generalHtml: string, edits: BlockEdit[]): string {
  if (!edits.length) return generalHtml;
  const { open, close, blocks } = splitBlocks(generalHtml);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; ) {
    const hit = edits.find((e) => e.base.length && e.base.every((b, k) => blocks[i + k] === b));
    if (hit) {
      out.push(hit.html);
      i += hit.base.length;
    } else {
      out.push(blocks[i]);
      i++;
    }
  }
  for (const e of edits) if (!e.base.length) out.push(e.html);
  return `${open}${out.join("")}${close}`;
}

/** The name typed into a greeting ("Hi Dave -", "Hello Dave/Jon,"), or null. */
export function greetingName(blockHtml: string): string | null {
  const text = blockHtml.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/​/g, "").replace(/\s+/g, " ").trim();
  const m = text.match(/^(?:Hi|Hello|Hey|Dear)\s+([A-Za-z][A-Za-z'’.]*(?:\s*\/\s*[A-Za-z][A-Za-z'’.]*)*)\s*(?:[-–—,:]|$)/);
  return m ? m[1].replace(/\s*\/\s*/g, "/") : null;
}
