import { linkStrayEmails, syncAllMailboxes } from "@/lib/mail-sync";
import { ensureDealsSubscription, processDealsInbox } from "@/lib/deals-inbox";
import { ensureIsraelSubscription, processIsraelInbox } from "@/lib/israel-intake";
import { syncIsraelMailboxes } from "@/lib/israel-mail";
import { closeLandedMentions, detectIsraelMentions } from "@/lib/israel-mentions";
import { refreshDashboardSignals } from "@/lib/dashboard-refresh";
import { proposeNamingConventions } from "@/lib/naming";
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
  const stray = await linkStrayEmails().catch(() => 0);
  await refreshDashboardSignals().catch(() => undefined);
  const naming = await proposeNamingConventions().catch((e) => String(e));
  const momentum = await refreshMomentum().catch((e) => String(e));
  const intros = await scanAllIntros().catch((e) => String(e));
  const israel = await processIsraelInbox().catch((e) => String(e));
  const israelMail = await syncIsraelMailboxes().catch((e) => String(e));
  const israelMentions = await detectIsraelMentions().catch((e) => String(e));
  await closeLandedMentions().catch(() => 0);
  const israelSubscription = await ensureIsraelSubscription().catch((e) => String(e));
  return Response.json({ ok: true, result, deals, subscription, stray, momentum, intros, israel, israelMail, israelMentions, israelSubscription, naming });
}
