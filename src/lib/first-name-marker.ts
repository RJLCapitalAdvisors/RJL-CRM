/**
 * The "General" email on the Send deal page is written once with no name in the greeting. The greeting holds
 * this invisible placeholder where the first name goes; each firm's email is the General email with the
 * placeholder swapped for its person's first name. Client-safe (no server imports).
 */
export const FIRST_NAME_MARKER = '<span data-first-name="">&#8203;</span>';
const MARKER_RE = /<span[^>]*data-first-name[^>]*>(?:&#8203;|&#x200b;|​|&nbsp;|\s)*<\/span>/gi;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The General email addressed to one person. */
export function withFirstName(html: string, firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return html.replace(MARKER_RE, name ? esc(name) : "there");
}

/** The General email with nobody's name (the preview you send yourself): "Hi - hope you are well." */
export function withoutName(html: string): string {
  return html.replace(MARKER_RE, "").replace(/Hi\s+(-|–|,)/g, "Hi $1");
}

export const hasMarker = (html: string) => MARKER_RE.test(html);
