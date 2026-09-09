import { runFollowUps, sendDueBlasts } from "@/lib/blasts";
import { syncAllMailboxes } from "@/lib/mail-sync";

export const maxDuration = 300;

/** Scheduled blasts go out; anyone who has not replied gets the follow-up. Guarded by CRON_SECRET. Also runs from page loads (kickBlasts). */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const key = new URL(req.url).searchParams.get("key");
  const secret = process.env.CRON_SECRET;
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) return new Response("Unauthorized", { status: 401 });
  await syncAllMailboxes().catch(() => ({})); // replies to blasts are found in the team mailboxes
  const sent = await sendDueBlasts().catch((e) => String(e));
  const followUps = await runFollowUps().catch((e) => String(e));
  return Response.json({ ok: true, blastsSent: sent, followUps });
}
