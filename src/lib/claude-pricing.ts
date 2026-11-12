/**
 * What a Claude call costs (Nov 12, 2026). Dollars per million tokens, copied from Anthropic's price list
 * (https://platform.claude.com/docs/en/about-claude/pricing) on Nov 12, 2026. When Anthropic changes a price or the
 * CRM starts using a model that is not here, edit this table; calls already logged keep the cost they were logged at.
 *
 * Every model writes to the prompt cache at 1.25x its input price (5-minute cache) or 2x (1-hour cache). Reading from
 * the cache is priced per model, so it has its own column.
 *
 * Not priced here because the CRM does not use them: fast mode, the Batch API, US-only inference and web search.
 */
type Price = { input: number; output: number; cacheRead: number };

const PRICES: Record<string, Price> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-mythos-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-mythos-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-1": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};
/** Claude Haiku 5.5 charges more for a request whose whole prompt is over 100,000 tokens. */
const HAIKU_5_5_LONG: Price = { input: 0.5, output: 2.5, cacheRead: 0.05 };

/** The model's name as the price list has it: a dated snapshot ("claude-haiku-4-5-20251001") is priced as its model. */
const plainModel = (model: string) => model.replace(/[-@]\d{8}$/, "");

export const hasPrice = (model: string) => plainModel(model) in PRICES;

/** The token counts of one call, as the API reports them. `input` is the input that touched no cache. */
export type CallTokens = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };

/** Dollars for one call. A model that is not on the list costs 0 here; the usage page says so beside it. */
export function costUsd(model: string, t: CallTokens): number {
  const name = plainModel(model);
  let p = PRICES[name];
  if (!p) return 0;
  if (name === "claude-haiku-5-5" && t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead > 100_000) p = HAIKU_5_5_LONG;
  return (t.input * p.input + t.cacheWrite5m * p.input * 1.25 + t.cacheWrite1h * p.input * 2 + t.cacheRead * p.cacheRead + t.output * p.output) / 1_000_000;
}
