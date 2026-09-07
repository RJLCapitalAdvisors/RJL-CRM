import { syncAllMailboxes } from "@/lib/mail-sync";
import { ensureDealsSubscription, processDealsInbox } from "@/lib/deals-inbox";
import { refreshMomentum } from "@/lib/momentum";
import { scanAllIntros } from "@/lib/intros";

export const maxDuration = 300;

/** Scheduled (vercel.json) and manual: read every team mailbox into the email log. Guarded by CRON_SECRET. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const key = new URL(req.url).searchParams.get("key");
  const secret = process.env.CRON_SECRET;
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) return new Response("Unauthorized", { status: 401 });
  const [result, deals, subscription] = await Promise.all([syncAllMailboxes(), processDealsInbox().catch((e) => String(e)), ensureDealsSubscription().catch((e) => String(e))]);
  const momentum = await refreshMomentum().catch((e) => String(e));
  const intros = await scanAllIntros().catch((e) => String(e));
  return Response.json({ ok: true, result, deals, subscription, momentum, intros });
}
