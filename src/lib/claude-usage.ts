import { prisma } from "@/lib/db";

/**
 * Reading the Claude usage log (the ClaudeCall table that src/lib/claude.ts writes) for the sidebar meter, the
 * out-of-credits banner and Settings > Claude usage (Nov 12, 2026).
 *
 * "Today" and "this month" are Jonathan's: days begin at midnight in New York, like every other date in the CRM.
 */
export const USAGE_ZONE = "America/New_York";

/** What each feature name in the log means, in plain words. A name missing here shows as it was logged. */
export const FEATURE_LABELS: Record<string, string> = {
  "ask-crm": "Ask the CRM",
  "ask-israel": "Ask the CRM (RJL Israel)",
  "ask-acquisitions": "Ask the CRM (RJL Acquisitions)",
  "deal-intake": "Reading a new deal (email, OM, model)",
  "ticket-fill": "Filling blank ticket fields from a later email or file",
  "deal-facts": "Saving deal facts from emails and files",
  "deal-narratives": "Improving the deal's written paragraphs",
  "business-plan": "Writing the business plan paragraph",
  "same-deal-check": "Checking whether an email is a deal already on file",
  "multi-deal-check": "Checking whether an email holds several deals",
  "forwarder-notes": "Following the forwarder's instructions on a deal email",
  "portfolio-plan": "Writing a portfolio's business plan",
  "email-revise": "Revising the deal email on the Send page",
  "suggest-investors": "Suggesting investors for a deal",
  "report-summary": "Progress report themes and items",
  "settle-asks": "Clearing sponsor items the ticket already answers",
  "lp-replies": "Reading investor replies",
  "sponsor-replies": "Reading sponsor replies to the deals inbox",
  "sponsor-answers": "Reading sponsor answers to investor questions",
  "deal-mentions": "Spotting deals mentioned in sponsor emails",
  "deal-momentum": "Deal momentum on the dashboard",
  "criteria-proposals": "Proposing investor criteria updates",
  "company-enrich": "Filling company details from its website",
  "call-transcripts": "Reading Fireflies call transcripts",
  "email-todo": "Turning an email into a to-do",
  "israel-intake": "Reading RJL Israel listings",
  "israel-mentions": "Spotting RJL Israel deals in emails",
};

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wall(at: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(at);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])) as Wall;
}

/** The instant a calendar day begins in the zone. `day` may run past either end of the month (0, -5, 40). */
function zoneMidnight(year: number, month: number, day: number, zone: string): Date {
  const want = Date.UTC(year, month - 1, day);
  let t = want;
  // start from midnight UTC and move by how far the zone's clock is off; the second pass settles a night the clocks change
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(t), zone);
    t -= Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - want;
  }
  return new Date(t);
}

/** Where the periods on the usage page begin, and the fourteen calendar days of the chart, oldest first. */
export function usagePeriods(now = new Date(), zone = USAGE_ZONE) {
  const { year, month, day } = wall(now, zone);
  const key = (back: number) => new Date(Date.UTC(year, month - 1, day - back)).toISOString().slice(0, 10);
  return {
    today: zoneMidnight(year, month, day, zone),
    week: zoneMidnight(year, month, day - 6, zone), // today and the six days before it
    month: zoneMidnight(year, month, 1, zone),
    chart: zoneMidnight(year, month, day - 13, zone),
    days: Array.from({ length: 14 }, (_, i) => key(13 - i)),
    todayKey: key(0),
    monthKey: key(0).slice(0, 7),
  };
}

export type Meter = { today: number; month: number; outOfCredits: boolean };

let memo: { at: number; value: Meter } | null = null;

/**
 * The sidebar's two numbers and whether the account is out of credits. Out of credits means the latest "no credits"
 * error is newer than the latest call that worked, so the banner clears itself on the first call after a top-up.
 * Kept for 15 seconds per server so a page full of people does not ask the database each time. Null when it cannot be read.
 */
export async function usageMeter(): Promise<Meter | null> {
  if (memo && Date.now() - memo.at < 15_000) return memo.value;
  const p = usagePeriods();
  const since = new Date(Math.min(p.month.getTime(), Date.now() - 35 * 86_400_000));
  try {
    const [row] = await prisma.$queryRaw<{ today: number; month: number; dry: Date | null; ok: Date | null }[]>`
      SELECT COALESCE(SUM("costUsd") FILTER (WHERE "at" >= ${p.today}), 0)::float8 AS today,
             COALESCE(SUM("costUsd") FILTER (WHERE "at" >= ${p.month}), 0)::float8 AS month,
             MAX("at") FILTER (WHERE "outOfCredits") AS dry,
             MAX("at") FILTER (WHERE "error" IS NULL) AS ok
      FROM "ClaudeCall" WHERE "at" >= ${since}`;
    const value: Meter = { today: row.today, month: row.month, outOfCredits: Boolean(row.dry && (!row.ok || row.dry > row.ok)) };
    memo = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

export type UsageRange = "today" | "week" | "month";
export type UsageTotal = { cost: number; calls: number };
export type UsageReport = {
  totals: Record<UsageRange, UsageTotal>;
  days: { day: string; cost: number; calls: number }[]; // fourteen, oldest first, a day with nothing at zero
  todayKey: string;
  rows: { feature: string; model: string; calls: number; failed: number; cost: number }[]; // for `range`, dearest first
  firstCall: Date | null;
};

export async function usageReport(range: UsageRange): Promise<UsageReport> {
  const p = usagePeriods();
  const since = new Date(Math.min(p.month.getTime(), p.chart.getTime()));
  const [byDay, rows, first] = await Promise.all([
    prisma.$queryRaw<{ day: string; cost: number; calls: number }[]>`
      SELECT to_char(("at" AT TIME ZONE 'UTC' AT TIME ZONE ${USAGE_ZONE})::date, 'YYYY-MM-DD') AS day, SUM("costUsd")::float8 AS cost, COUNT(*)::int AS calls
      FROM "ClaudeCall" WHERE "at" >= ${since} GROUP BY 1`,
    prisma.$queryRaw<UsageReport["rows"]>`
      SELECT "feature", "model", COUNT(*)::int AS calls, (COUNT(*) FILTER (WHERE "error" IS NOT NULL))::int AS failed, SUM("costUsd")::float8 AS cost
      FROM "ClaudeCall" WHERE "at" >= ${p[range]} GROUP BY 1, 2 ORDER BY cost DESC, calls DESC`,
    prisma.claudeCall.findFirst({ orderBy: { at: "asc" }, select: { at: true } }),
  ]);
  const sum = (keep: (day: string) => boolean): UsageTotal => byDay.filter((d) => keep(d.day)).reduce((t, d) => ({ cost: t.cost + d.cost, calls: t.calls + d.calls }), { cost: 0, calls: 0 });
  const lastSeven = new Set(p.days.slice(-7));
  const found = new Map(byDay.map((d) => [d.day, d]));
  return {
    totals: { today: sum((d) => d === p.todayKey), week: sum((d) => lastSeven.has(d)), month: sum((d) => d.startsWith(p.monthKey)) },
    days: p.days.map((day) => ({ day, cost: found.get(day)?.cost ?? 0, calls: found.get(day)?.calls ?? 0 })),
    todayKey: p.todayKey,
    rows,
    firstCall: first?.at ?? null,
  };
}
