import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { costUsd } from "@/lib/claude-pricing";

/**
 * The one way the CRM talks to Claude (Nov 12, 2026). `claude("deal-intake")` is an ordinary Anthropic client whose
 * every message call is written to the ClaudeCall table when it finishes: the time, the feature name given here, the
 * model, the tokens, the cost and the error if it failed. The answer the caller gets back is untouched.
 *
 * Never write `new Anthropic()` anywhere else: a call made that way is missing from the sidebar meter and from
 * Settings > Claude usage.
 *
 * What is counted: `messages.create`, `messages.parse` and `messages.stream(...).finalMessage()`, which is everything
 * the CRM uses. A raw event stream (`messages.create({ stream: true })`) and the beta endpoints are passed through
 * uncounted; add them here before using them.
 */
export function claude(feature: string): Anthropic {
  const client = new Anthropic();
  const messages = client.messages;
  const create = messages.create.bind(messages);
  const stream = messages.stream.bind(messages);

  // `messages.parse` is built on `messages.create` inside the SDK, so counting create counts both
  messages.create = ((body: Anthropic.MessageCreateParams, options?: Anthropic.RequestOptions) => {
    if (body.stream) return create(body, options); // the stream helper's own request, counted below when its message is whole
    return counted(feature, body.model, () => create(body, options));
  }) as typeof messages.create;

  messages.stream = ((body: Anthropic.MessageStreamParams, options?: Anthropic.RequestOptions) => {
    const running = stream(body, options);
    const finalMessage = running.finalMessage.bind(running);
    let whole: Promise<Anthropic.Message> | null = null;
    running.finalMessage = (() => (whole ??= counted(feature, body.model, finalMessage))) as typeof running.finalMessage;
    return running;
  }) as typeof messages.stream;

  return client;
}

async function counted<T extends Anthropic.Message>(feature: string, model: string, run: () => PromiseLike<T>): Promise<T> {
  let message: T;
  try {
    message = await run();
  } catch (e) {
    await record({ feature, model, ...failure(e) });
    throw e;
  }
  const u = message.usage;
  const cacheWrite1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const billedAs = message.model || model;
  await record({
    feature,
    model: billedAs,
    inputTokens: u.input_tokens + cacheWrite + cacheRead,
    outputTokens: u.output_tokens,
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    costUsd: costUsd(billedAs, { input: u.input_tokens, output: u.output_tokens, cacheWrite5m: Math.max(0, cacheWrite - cacheWrite1h), cacheWrite1h, cacheRead }),
  });
  return message;
}

/** The error to keep, and whether it means the Anthropic account has run out of credits. */
export function failure(e: unknown): { error: string; outOfCredits: boolean } {
  if (e instanceof Anthropic.APIError) {
    // Anthropic answers a request on an empty balance with "Your credit balance is too low to access the Anthropic API",
    // sent as a plain 400, so the wording is the only thing that tells it apart; billing_error (402) is the typed form
    const outOfCredits = e.status === 402 || e.type === "billing_error" || /credit balance is too low/i.test(e.message);
    return { error: e.message.slice(0, 500), outOfCredits };
  }
  return { error: String(e instanceof Error ? e.message : e).slice(0, 500), outOfCredits: false };
}

type Row = { feature: string; model: string; inputTokens?: number; outputTokens?: number; cacheWriteTokens?: number; cacheReadTokens?: number; costUsd?: number; error?: string; outOfCredits?: boolean };

/** Saves the row before the caller carries on (work left running after a response is not kept alive on Vercel). A database that is slow or down costs the feature at most three seconds and never an error. */
async function record(row: Row): Promise<void> {
  const saved = prisma.claudeCall.create({ data: row, select: { id: true } }).then(
    () => undefined,
    (e) => console.error("Claude call not logged:", e instanceof Error ? e.message : e),
  );
  await Promise.race([saved, new Promise<void>((done) => setTimeout(done, 3000))]);
}
