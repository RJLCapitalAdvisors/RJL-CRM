import { CHECK_SIZES } from "@/lib/taxonomy";

/** Dollar amount -> the check-size bucket it falls in. */
export function bucketForAmount(amount: number | null | undefined): string {
  if (!amount) return "";
  const mm = amount / 1_000_000;
  for (const b of CHECK_SIZES) {
    const m = b.match(/^\$(\d+)(?:-(\d+))?MM(\+)?$/);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[3] ? Infinity : Number(m[2]);
    if (mm >= lo && mm <= hi) return b;
  }
  return "";
}

/** Year built -> vintage bucket. */
export function vintageForYear(yearBuilt: string | null | undefined): string {
  if (!yearBuilt) return "";
  const y = Number((yearBuilt.match(/\d{4}/) ?? [])[0]);
  if (!y) return /new|construction/i.test(yearBuilt) ? "New Construction" : "";
  if (y >= 2024) return "New Construction";
  if (y < 1960) return "Older than 1960";
  return `${Math.floor(y / 10) * 10}s`;
}
