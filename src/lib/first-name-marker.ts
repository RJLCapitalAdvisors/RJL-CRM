/**
 * The "General" email on the Send deal page is written once with no name in the greeting. The greeting holds
 * this invisible placeholder where the first name goes; each firm's email is the General email with the
 * placeholder swapped for its person's first name (or names: "Dave/Jon" when two people are primary; Jonathan,
 * Oct 1, 2026). Nobody's name known: the greeting is left blank ("Hi - hope you are well"), never an email
 * address, never "there". Client-safe (no server imports).
 */
export const FIRST_NAME_MARKER = '<span data-first-name="">&#8203;</span>';
const MARKER_RE = /<span[^>]*data-first-name[^>]*>(?:&#8203;|&#x200b;|​|&nbsp;|\s)*<\/span>/gi;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The General email addressed to one person (or "Dave/Jon"); blank greeting when no name is known. */
export function withFirstName(html: string, firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim().replace(/@.*/, ""); // never an email address in a greeting
  const out = html.replace(MARKER_RE, name ? esc(name) : "");
  return name ? out : out.replace(/(Hi|Hello|Hey|Dear)\s+(?=[-–,])/g, "$1 ").replace(/(Hi|Hello|Hey|Dear)\s{2,}/g, "$1 ");
}

/** The General email with nobody's name (the preview you send yourself): "Hi - hope you are well." */
export function withoutName(html: string): string {
  return withFirstName(html, "");
}

export const hasMarker = (html: string) => MARKER_RE.test(html);
