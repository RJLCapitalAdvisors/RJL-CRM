/**
 * Relative day words turned into calendar dates (Jonathan, Oct 19, 2026: "we don't need words like 'tomorrow' which quickly
 * become inaccurate" on a progress report). "tomorrow" written on Oct 8 is "Oct 9"; "Monday" is the next Monday after the
 * email; "next week" is "the week of <that Monday>". The base is when the words were written (the email's date).
 */
const DAY = 86_400_000;
const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const nyWeekday = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

export function absoluteDates(text: string, base: Date): string {
  if (!text || !/\b(tomorrow|yesterday|today|tonight|this (?:afternoon|morning|week)|later today|next week|end of (?:the )?week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) return text;
  const nextDay = (day: string, next: boolean) => {
    const target = WEEK.indexOf(day.toLowerCase());
    let diff = (target - nyWeekday(base) + 7) % 7;
    if (diff === 0) diff = 7;
    if (next && diff < 7) diff += 7 * (nyWeekday(base) <= target ? 1 : 0); // "next Monday" said on a Tuesday is the one after this coming Monday only when the day has not passed
    return plus(base, diff);
  };
  const thisMonday = plus(base, ((1 - nyWeekday(base) + 7) % 7 || 7) - 7);
  let out = text;
  out = out.replace(/\bthe day after tomorrow\b/gi, fmt(plus(base, 2)));
  out = out.replace(/\btomorrow\b/gi, fmt(plus(base, 1)));
  out = out.replace(/\byesterday\b/gi, fmt(plus(base, -1)));
  out = out.replace(/\b(?:later )?(?:today|tonight|this afternoon|this morning)\b/gi, fmt(base));
  // a weekday that already comes with its date ("Thursday 10/22", "Friday, Oct 23") only loses the weekday
  out = out.replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(?=\d{1,2}\/\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2})/gi, "");
  out = out.replace(/\b(?:the )?end of (?:the |this )?week\b/gi, fmt(plus(thisMonday, 4)));
  out = out.replace(/\blater this week\b/gi, fmt(plus(thisMonday, 4)));
  out = out.replace(/\bearly next week\b/gi, `early in the week of ${fmt(plus(thisMonday, 7))}`);
  out = out.replace(/\bnext week\b/gi, `the week of ${fmt(plus(thisMonday, 7))}`);
  out = out.replace(/\bthis week\b/gi, `the week of ${fmt(thisMonday)}`);
  // a weekday name is a date; "Black Friday" or "Good Friday" is not
  out = out.replace(/(?<!\b(?:black|good|easter|cyber)\s)\b(?:(this|next|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, (_m, q: string | undefined, day: string) => `${q && q.toLowerCase() === "on" ? "on " : ""}${fmt(nextDay(day, (q ?? "").toLowerCase() === "next"))}`);
  return out;
}
