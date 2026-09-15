import { isBlindIntro } from "@/lib/taxonomy";

/**
 * Which deals carry a live progress report. Two rules from Jonathan (Sep 15, 2026):
 *  - A simple intro is not a progress report. Only a deal whose full investor list went out counts, read as at
 *    least REPORT_MIN_SENT investors at Deal Sent or further and not an INTRO ticket.
 *  - "Not active" on the Active progress reports page takes a report off the page until the deal is triggered
 *    again: an investor row changing after that click (a new response, a follow-up, another send) brings it back.
 */
export const REPORT_MIN_SENT = 5;

type Row = { status: number; updatedAt: Date };

export function reportQualifies(dealName: string, investors: { status: number }[]): boolean {
  if (isBlindIntro({ name: dealName })) return false;
  return investors.filter((r) => r.status >= 2).length >= REPORT_MIN_SENT;
}

export function reportActive(reportInactiveAt: Date | null | undefined, investors: Row[]): boolean {
  if (!reportInactiveAt) return true;
  return investors.some((r) => r.updatedAt > reportInactiveAt);
}
