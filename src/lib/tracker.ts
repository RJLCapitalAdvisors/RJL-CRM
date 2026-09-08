// Investor progress tracker: the eight statuses from the legacy Google Drive progress report.

export type TrackerStatus = { id: number; label: string; short: string; bg: string; c: string; d: string; meaning: string };

// Labels and cell colors copied from the Word progress reports Jonathan sends sponsors.
export const TRACKER_STATUSES: TrackerStatus[] = [
  { id: 1, label: "1. Deal Not Sent", short: "Deal Not Sent", bg: "#e6e6e6", c: "#3d3d3d", d: "#3d3d3d", meaning: "Not yet reached" },
  { id: 2, label: "2. Deal Sent - Awaiting Response", short: "Deal Sent", bg: "#e6cff2", c: "#5a3286", d: "#5a3286", meaning: "Materials sent, no response" },
  { id: 3, label: "3. Followed Up After No Response", short: "Followed Up", bg: "#ffe5a0", c: "#473821", d: "#473821", meaning: "Follow-up sent, awaiting" },
  { id: 4, label: "4. Taking A Look", short: "Taking A Look", bg: "#d4edbc", c: "#11734b", d: "#11734b", meaning: "Active review in progress" },
  { id: 5, label: "5. Interested", short: "Interested", bg: "#bfe0f6", c: "#0a53a8", d: "#0a53a8", meaning: "Expressed interest" },
  { id: 6, label: "6. Intro Made", short: "Intro Made", bg: "#0a53a8", c: "#bfe0f6", d: "#bfe0f6", meaning: "Sponsor intro completed" },
  { id: 7, label: "7. Not A Fit", short: "Not A Fit", bg: "#ffcfc9", c: "#b10202", d: "#b10202", meaning: "Soft decline / wrong focus" },
  { id: 8, label: "8. Pass", short: "Pass", bg: "#ffcfc9", c: "#b10202", d: "#b10202", meaning: "Hard pass / declined" },
];

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
/** Append a note to a report row unless an equivalent one is already there; segments are joined with " | ". */
export function mergeNote(existing: string | null | undefined, note: string): string {
  const parts = (existing ?? "").split(" | ").map((x) => x.trim()).filter(Boolean);
  if (parts.some((p) => sameNote(p, note))) return parts.join(" | ");
  return [...parts, note.trim()].join(" | ");
}
/** Collapse duplicate segments already sitting in a note. */
export function dedupeNote(existing: string | null | undefined): string | null {
  const parts = (existing ?? "").split(" | ").map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) if (!out.some((o) => sameNote(o, p))) out.push(p);
  return out.length ? out.join(" | ") : null;
}
