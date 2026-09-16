/**
 * Outgoing email HTML the way Outlook itself writes it: Calibri 11pt on every block, no leftover styling from
 * wherever a template came from. Jonathan (Sep 16): the emails looked like HubSpot emails once the templates
 * came in; they should read exactly like an email typed in Outlook. HubSpot exports wrap text in
 * <span style="color: rgb(0, 0, 0)"><span style="font-size: 14.6667px"><span style="font-family: sans-serif">,
 * use <p style="margin:0;"> with <br class="hs-trailingbreak"> paragraphs for blank lines, and <li><p>. All of
 * that goes; the paragraph margin is the spacing; every p, li and div carries Calibri 11pt inline because Word's
 * engine falls back to its own default font on blocks that do not state one.
 */
export const FONT = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";

const HS_SPAN = /<span style="\s*(?:(?:color:\s*rgb\(0,\s*0,\s*0\);?|font-size:\s*14\.6667px;?|font-family:\s*sans-serif;?)\s*)+">/gi;

/** Strip what HubSpot (or a paste from it) left behind. Bold, italics, underline, lists and links stay; so does a font or size someone chose on purpose. */
export function cleanTemplateHtml(html: string): string {
  let s = html
    .replace(HS_SPAN, "<span>")
    // the same three declarations sit on li and p tags too, sometimes with margin:0; they go, and an emptied style attribute goes with them
    .replace(/\sstyle="([^"]*)"/gi, (_m, v: string) => {
      const kept = v
        .replace(/(?:^|;)\s*(?:font-size:\s*14\.6667px|color:\s*rgb\(0,\s*0,\s*0\)|font-family:\s*sans-serif|margin:\s*0(?:px)?)\s*(?=;|$)/gi, "")
        .replace(/^;+|;+$/g, "")
        .trim();
      return kept ? ` style="${kept}"` : "";
    })
    .replace(/<div(?:\s+style="")?\s+dir="auto"\s+data-top-level="true">/gi, "<div>")
    .replace(/<br\s+class="hs-trailingbreak"\s*\/?>/gi, "<br>")
    .replace(/<p style="margin:\s*0;?">/gi, "<p>")
    .replace(/&nbsp;/g, " ");
  // artifacts of the browser's own font commands: a <strong> stretched around a list bolds every value in it
  s = s
    .replace(/<(strong|b)(?:\s[^>]*)?>\s*(<(?:ul|ol)\b)/gi, "$2")
    .replace(/(<\/(?:ul|ol)>)\s*<\/(?:strong|b)>/gi, "$1")
    .replace(/<(strong|b)\s+style="[^"]*">/gi, "<$1>")
    .replace(/\sstyle="([^"]*)"/gi, (_m, v: string) => {
      const kept = v.replace(/(?:^|;)\s*font-weight:\s*(?:bolder|normal|400)\s*(?=;|$)/gi, "").replace(/^;+|;+$/g, "").trim();
      return kept ? ` style="${kept}"` : "";
    });
  // bare spans (the HubSpot ones, now styleless) unwrap from the inside out
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/<span>((?:(?!<\/?span\b)[\s\S])*)<\/span>/gi, "$1");
  }
  return s
    .replace(/<li([^>]*)>\s*<p[^>]*>/gi, "<li$1>")
    .replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<(p|div)>\s*(?:<br\s*\/?>)+\s*<\/\1>/gi, "")
    .replace(/(<\/(?:p|div|ul|ol)>)\s*<br\s*\/?>\s*(?=<(?:p|div|ul|ol)\b)/gi, "$1");
}

/** Calibri 11pt on every block, paragraph and list spacing as Outlook shows it. Styles an element already carries stay and win. */
export function outlookHtml(html: string): string {
  return cleanTemplateHtml(html).replace(/<(p|li|div|td|ul|ol)(\s[^>]*)?>/gi, (_m, tag: string, attrs = "") => {
    const t = tag.toLowerCase();
    const base = t === "p" ? `margin:0 0 10pt 0;${FONT}` : t === "li" ? `margin:0;${FONT}` : t === "ul" ? `margin:0 0 10pt 18pt;list-style-type:disc;${FONT}` : t === "ol" ? `margin:0 0 10pt 18pt;list-style-type:decimal;${FONT}` : FONT;
    const sm = attrs.match(/\sstyle="([^"]*)"/i);
    if (!sm) return `<${t}${attrs} style="${base}">`;
    const own = sm[1].trim();
    const merged = own ? `${base}${own.endsWith(";") ? own : own + ";"}` : base;
    return `<${t}${attrs.replace(sm[0], ` style="${merged}"`)}>`;
  });
}
