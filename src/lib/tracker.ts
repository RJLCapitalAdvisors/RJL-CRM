// Investor progress tracker: the eight statuses from the legacy Google Drive progress report.

export type TrackerStatus = { id: number; rank: number; label: string; short: string; bg: string; c: string; d: string; meaning: string };

// Labels and cell colors copied from the Word progress reports Jonathan sends sponsors. `id` is what the database
// stores and the code compares (never renumbered); `rank` is the number the report prints and sorts by: Pass and
// Not A Fit are 1 and 2 so they always sit at the bottom, Intro Made is 8 at the top (Jonathan, Sep 22, 2026).
const STATUS_ROWS: Omit<TrackerStatus, "label">[] = [
  { id: 1, rank: 3, short: "Deal Not Sent", bg: "#e6e6e6", c: "#3d3d3d", d: "#3d3d3d", meaning: "Not yet reached" },
  { id: 2, rank: 4, short: "Deal Sent - Awaiting Response", bg: "#e6cff2", c: "#5a3286", d: "#5a3286", meaning: "Materials sent, no response" },
  { id: 3, rank: 5, short: "Followed Up After No Response", bg: "#ffe5a0", c: "#473821", d: "#473821", meaning: "Follow-up sent, awaiting" },
  { id: 4, rank: 6, short: "Taking A Look", bg: "#d4edbc", c: "#11734b", d: "#11734b", meaning: "Active review in progress" },
  { id: 5, rank: 7, short: "Interested", bg: "#bfe0f6", c: "#0a53a8", d: "#0a53a8", meaning: "Expressed interest" },
  { id: 6, rank: 8, short: "Intro Made", bg: "#0a53a8", c: "#bfe0f6", d: "#bfe0f6", meaning: "Sponsor intro completed" },
  { id: 7, rank: 2, short: "Not A Fit", bg: "#ffcfc9", c: "#b10202", d: "#b10202", meaning: "Soft decline / wrong focus" },
  { id: 8, rank: 1, short: "Pass", bg: "#ffcfc9", c: "#b10202", d: "#b10202", meaning: "Hard pass / declined" },
  { id: 9, rank: 9, short: "Term Sheet Issued", bg: "#11734b", c: "#d4edbc", d: "#d4edbc", meaning: "The group issued a term sheet" },
];
export const STATUS_INTRO_MADE = 6;
export const STATUS_PASS = 8;
export const STATUS_TERM_SHEET = 9;
/** Groups owed nothing on Items Needed from Sponsor: passed, not a fit, or already at a term sheet (Jonathan, Sep 22, 2026). */
export const owedNothing = (status: number) => status === 7 || status === 8 || status === 9;
export const TRACKER_STATUSES: TrackerStatus[] = STATUS_ROWS.map((s) => ({ ...s, label: `${s.rank}. ${s.short}`, short: s.short.split(" - ")[0].replace(" After No Response", "") }));
/** The statuses in report order, top to bottom: Intro Made first, Pass last. */
export const TRACKER_STATUSES_BY_RANK = [...TRACKER_STATUSES].sort((a, b) => b.rank - a.rank);
export const rankOf = (id: number) => statusOf(id).rank;

export const STATUS_SENT = 2;
export const STATUS_FOLLOWED_UP = 3;
/** Statuses that count as "has not responded yet" for follow-ups. */
export const AWAITING_RESPONSE = [2, 3];

export function statusOf(id: number): TrackerStatus {
  return TRACKER_STATUSES.find((s) => s.id === id) ?? TRACKER_STATUSES[0];
}

/** The firm name, as on the Word reports; falls back to the person or email. */
export function investorLabel(c: { firstName: string | null; lastName: string | null; email: string | null; company: { name: string } | null }) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return c.company?.name || person || c.email || "(unknown)";
}
export function personLabel(c: { firstName: string | null; lastName: string | null; email: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.email || "";
}

export function fmtReportDate(d: Date | null | undefined) {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const noteWords = (s: string) => new Set(s.toLowerCase().replace(/\(\w{3} \d{1,2}\)/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3));
/** Two note segments about the same thing (same date tag, most words shared) count as one. */
export function sameNote(a: string, b: string): boolean {
  const da = a.match(/\((\w{3} \d{1,2})\)\s*$/)?.[1], db = b.match(/\((\w{3} \d{1,2})\)\s*$/)?.[1];
  if (da && db && da !== db) return false;
  const A = noteWords(a), B = noteWords(b);
  if (!A.size || !B.size) return a.trim() === b.trim();
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size) >= 0.6;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The "(Sep 4)" tag at the end of a segment, as a sortable day number; segments without a tag sort last, in the order written. */
function noteDay(seg: string): number {
  const m = seg.match(/\((\w{3}) (\d{1,2})\)\s*$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return Number.MAX_SAFE_INTEGER;
  const now = new Date();
  let year = now.getFullYear();
  if (month > now.getMonth() + 1) year -= 1; // a month well ahead of today belongs to last year
  return Date.UTC(year, month, Number(m[2]));
}
/**
 * One entry per response, oldest first. Exact repeats and near repeats (same date, most words shared) collapse
 * to the first one seen, so a refresh that reads the same email again never adds a second line.
 */
export function normalizeNote(segments: string[]): string | null {
  const out: string[] = [];
  for (const seg of segments.map((x) => x.trim()).filter(Boolean)) if (!out.some((o) => sameNote(o, seg))) out.push(seg);
  out.sort((a, b) => noteDay(a) - noteDay(b));
  return out.length ? out.join(" | ") : null;
}
/** Append a note to a report row unless an equivalent one is already there; segments are joined with " | " in date order. */
export function mergeNote(existing: string | null | undefined, note: string): string {
  return normalizeNote([...(existing ?? "").split(" | "), note]) ?? "";
}
/** Collapse duplicate segments already sitting in a note and put them in date order. */
export function dedupeNote(existing: string | null | undefined): string | null {
  return normalizeNote((existing ?? "").split(" | "));
}
/** The note as its entries, oldest first. */
export const noteSegments = (note: string | null | undefined): string[] => (note ?? "").split(" | ").map((x) => x.trim()).filter(Boolean);
/**
 * Once a group passes (or is not a fit), the report keeps only the reason for the pass (Jonathan, Sep 22, 2026):
 * the entries written on the day of the last one, which is the passing email; everything earlier goes. Without date
 * tags, the last entry stays.
 */
export function passReasonOnly(note: string | null | undefined): string | null {
  // (status 9, a term sheet, keeps its notes; only 7 and 8 prune)
  const segs = noteSegments(note);
  if (segs.length <= 1) return segs[0] ?? null;
  const last = segs[segs.length - 1];
  const tag = last.match(/\((\w{3} \d{1,2})\)\s*$/)?.[1];
  const kept = tag ? segs.filter((s) => s.endsWith(`(${tag})`)) : [last];
  return kept.join(" | ");
}
/** What a progress report prints for a row: every entry as its own bullet; a passed or not-a-fit row shows only the reason. */
export const reportNoteLines = (note: string | null | undefined, status: number): string[] => noteSegments(status === 7 || status === 8 ? passReasonOnly(note) : note);
