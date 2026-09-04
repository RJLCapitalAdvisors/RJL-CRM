// Investor progress tracker: the eight statuses from the legacy Google Drive progress report.

export type TrackerStatus = { id: number; label: string; short: string; bg: string; c: string; d: string; meaning: string };

export const TRACKER_STATUSES: TrackerStatus[] = [
  { id: 1, label: "1. Deal Not Sent", short: "Deal Not Sent", bg: "#F1F3F8", c: "#6B7A99", d: "#94A3BE", meaning: "Not yet reached" },
  { id: 2, label: "2. Deal Sent", short: "Deal Sent", bg: "#EDE9FE", c: "#5B21B6", d: "#7C3AED", meaning: "Materials sent, no response" },
  { id: 3, label: "3. Followed Up", short: "Followed Up", bg: "#FEF9C3", c: "#854D0E", d: "#EAB308", meaning: "Follow-up sent, awaiting" },
  { id: 4, label: "4. Taking A Look", short: "Taking A Look", bg: "#D1FAE5", c: "#065F46", d: "#10B981", meaning: "Active review in progress" },
  { id: 5, label: "5. Interested", short: "Interested", bg: "#DBEAFE", c: "#1E40AF", d: "#3B82F6", meaning: "Expressed interest" },
  { id: 6, label: "6. Intro Made", short: "Intro Made", bg: "#1e3a8a", c: "#BFDBFE", d: "#93C5FD", meaning: "Sponsor intro completed" },
  { id: 7, label: "7. Not A Fit", short: "Not A Fit", bg: "#FEE2E2", c: "#7F1D1D", d: "#F87171", meaning: "Soft decline / wrong focus" },
  { id: 8, label: "8. Pass", short: "Pass", bg: "#FECACA", c: "#991B1B", d: "#DC2626", meaning: "Hard pass / declined" },
];

export const STATUS_SENT = 2;
export const STATUS_FOLLOWED_UP = 3;
/** Statuses that count as "has not responded yet" for follow-ups. */
export const AWAITING_RESPONSE = [2, 3];

export function statusOf(id: number): TrackerStatus {
  return TRACKER_STATUSES.find((s) => s.id === id) ?? TRACKER_STATUSES[0];
}

/** "Firm (Contact Name)" like the legacy report; falls back to whatever exists. */
export function investorLabel(c: { firstName: string | null; lastName: string | null; email: string | null; company: { name: string } | null }) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  if (c.company?.name && person) return `${c.company.name} (${person})`;
  return c.company?.name ?? person ?? c.email ?? "(unknown)";
}

export function fmtReportDate(d: Date | null | undefined) {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
