import { prisma } from "@/lib/db";
import { ACTIVE_STAGES } from "@/lib/taxonomy";
import { graph, graphConfigured } from "@/lib/graph";
import { firefliesConfigured, recentTranscripts } from "@/lib/fireflies";
import { STATUS_INTRO_MADE, noteSegments, normalizeNote } from "@/lib/tracker";

/**
 * Intro calls that already happened (Jonathan, Sep 22, 2026). A report row at Taking A Look or Interested moves to
 * Intro Made once there is evidence the group and the sponsor met: a Fireflies recording whose participants include
 * someone at the group and someone at the sponsor (or whose title names the deal), or a meeting on a team calendar
 * that has ended with both on the invite. Notes from before the call come off the report (scheduling chatter); what
 * was said from the call onward stays, and a dated "Intro call held" entry is written. Runs with the mail sync.
 */
const DAY = 86_400_000;
const LOOKBACK_DAYS = 120;
const domainOf = (e: string) => e.toLowerCase().split("@")[1] ?? "";
const dateTag = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayOfTag = (seg: string): number | null => {
  const m = seg.match(/\((\w{3}) (\d{1,2})\)\s*$/);
  if (!m) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const now = new Date();
  const year = month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
  return Date.UTC(year, month, Number(m[2]));
};

type Meeting = { at: Date; via: "Fireflies" | "calendar"; title: string; emails: string[] };

async function calendarMeetings(since: Date): Promise<Meeting[]> {
  if (!graphConfigured()) return [];
  const users = await prisma.user.findMany({ where: { active: true, email: { endsWith: "@rjlcapadvisors.com" } }, select: { email: true } });
  const out: Meeting[] = [];
  for (const u of users) {
    if (!u.email) continue;
    try {
      const r = await graph<{ value: { subject: string | null; start: { dateTime: string }; end: { dateTime: string }; isCancelled?: boolean; attendees?: { emailAddress?: { address?: string } }[] }[] }>(
        `/users/${encodeURIComponent(u.email)}/calendarView?startDateTime=${since.toISOString()}&endDateTime=${new Date().toISOString()}&$select=subject,start,end,attendees,isCancelled&$top=200`,
      );
      for (const e of r.value ?? []) {
        if (e.isCancelled) continue;
        const end = new Date(e.end.dateTime.endsWith("Z") ? e.end.dateTime : `${e.end.dateTime}Z`);
        if (end.getTime() > Date.now()) continue;
        out.push({ at: new Date(e.start.dateTime.endsWith("Z") ? e.start.dateTime : `${e.start.dateTime}Z`), via: "calendar", title: e.subject ?? "", emails: (e.attendees ?? []).map((a) => a.emailAddress?.address?.toLowerCase() ?? "").filter(Boolean) });
      }
    } catch {
      /* Calendars.Read not granted for this mailbox, or no calendar: the Fireflies evidence still counts */
    }
  }
  return out;
}

async function firefliesMeetings(since: Date): Promise<Meeting[]> {
  if (!firefliesConfigured()) return [];
  const all = await recentTranscripts(2).catch(() => []);
  return all.filter((t) => t.date.getTime() >= since.getTime() && t.date.getTime() <= Date.now()).map((t) => ({ at: t.date, via: "Fireflies" as const, title: t.title, emails: t.participants.map((p) => p.toLowerCase()) }));
}

export async function detectIntroCalls(): Promise<{ checked: number; moved: number }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  const [cal, ff] = await Promise.all([calendarMeetings(since), firefliesMeetings(since)]);
  const meetings = [...ff, ...cal];
  if (!meetings.length) return { checked: 0, moved: 0 };
  const rows = await prisma.dealInvestor.findMany({
    where: { status: { in: [4, 5] }, deal: { stage: { in: [...ACTIVE_STAGES] } } },
    include: { contact: { select: { id: true, email: true, company: { select: { name: true, domain: true } } } }, deal: { select: { id: true, name: true, propertyName: true, sponsorName: true, sponsorCompany: { select: { domain: true, name: true } }, createdAt: true } } },
  });
  let moved = 0;
  for (const r of rows) {
    const lpDomain = r.contact.company?.domain?.toLowerCase() || (r.contact.email ? domainOf(r.contact.email) : "");
    if (!lpDomain || /gmail|yahoo|outlook|hotmail/.test(lpDomain)) continue;
    const sponsorDomain = r.deal.sponsorCompany?.domain?.toLowerCase() ?? "";
    const dealWords = [r.deal.propertyName, r.deal.sponsorName, r.deal.sponsorCompany?.name].filter((x): x is string => Boolean(x && x.length >= 4)).map((x) => x.toLowerCase());
    const lpName = (r.contact.company?.name ?? "").toLowerCase();
    const hit = meetings
      .filter((m) => m.at.getTime() >= r.deal.createdAt.getTime() - 7 * DAY)
      .find((m) => {
        const domains = new Set(m.emails.map(domainOf));
        const withLp = domains.has(lpDomain) || (lpName.length >= 4 && m.title.toLowerCase().includes(lpName));
        const withSponsor = (sponsorDomain && domains.has(sponsorDomain)) || dealWords.some((w) => m.title.toLowerCase().includes(w));
        return withLp && withSponsor;
      });
    if (!hit) continue;
    // the call happened: Intro Made, pre-call entries off the report, a dated line for the call itself
    const day = Date.UTC(hit.at.getFullYear(), hit.at.getMonth(), hit.at.getDate());
    const segs = noteSegments(r.note);
    const kept = segs.filter((s) => {
      const d = dayOfTag(s);
      return d == null || d >= day;
    });
    const dropped = segs.filter((s) => !kept.includes(s));
    const note = normalizeNote([...kept, `Intro call held with ${r.deal.sponsorName ?? "the sponsor"} (${dateTag(hit.at)})`]);
    await prisma.dealInvestor.update({ where: { id: r.id }, data: { status: STATUS_INTRO_MADE, note, noteDate: hit.at, updatedAt: new Date() } });
    await prisma.activity.create({ data: { type: "NOTE", dealId: r.deal.id, contactId: r.contact.id, body: `Tracker: Intro Made. ${hit.via === "Fireflies" ? "Fireflies recorded" : "The calendar shows"} "${hit.title}" on ${dateTag(hit.at)}${dropped.length ? `. Report notes from before the call (kept off the report): ${dropped.join(" | ")}` : ""}` } }).catch(() => null);
    moved++;
  }
  return { checked: rows.length, moved };
}
