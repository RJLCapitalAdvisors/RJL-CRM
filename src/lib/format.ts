export function fullName(c: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  const n = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return n || c.email || "(no name)";
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null) return "";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}MM`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function fmtPct(n: number | null | undefined) {
  if (n == null) return "";
  return `${n}%`;
}

export function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}
