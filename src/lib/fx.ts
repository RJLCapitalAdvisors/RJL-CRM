/** Live shekel rate for the RJL Israel tickets. ECB reference rates via frankfurter.app, refreshed hourly. */
export type FxRate = { ilsPerUsd: number; date: string };

export async function usdIls(): Promise<FxRate | null> {
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=ILS", { next: { revalidate: 3600 } });
    if (!r.ok) return null;
    const j = (await r.json()) as { date?: string; rates?: { ILS?: number } };
    return j.rates?.ILS ? { ilsPerUsd: j.rates.ILS, date: j.date ?? "" } : null;
  } catch {
    return null;
  }
}
