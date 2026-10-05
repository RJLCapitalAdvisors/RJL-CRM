/** Yield colour for the Map View heat map (client-safe): cool for thin yields, hot for fat ones, on a 1.5% to 5% scale. */
export const YIELD_LOW = 1.5;
export const YIELD_HIGH = 5;
export function yieldColor(yieldPct: number | null | undefined): string | null {
  if (yieldPct == null || !isFinite(yieldPct)) return null;
  const t = Math.max(0, Math.min(1, (yieldPct - YIELD_LOW) / (YIELD_HIGH - YIELD_LOW)));
  const hue = Math.round(220 - 220 * t); // 220 blue -> 0 red
  return `hsl(${hue} 85% 45%)`;
}
