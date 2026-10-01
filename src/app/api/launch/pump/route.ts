import { prisma } from "@/lib/db";
import { pumpAllLaunches } from "@/lib/launch-queue";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The launch pump, driven from the server (Oct 1, 2026). It sends what is due from every mailbox *inside* the request:
 * for up to about two minutes when the database's minute scheduler calls it (pg_cron on Supabase hits this URL every minute),
 * for about 8 seconds when the Send deal page kicks it after queueing (`quick=1`). Background work after the response
 * is not kept alive reliably on Vercel, which is why the first version of this route left emails sitting in the queue.
 */
async function run(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const secret = process.env.CRON_SECRET;
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });
  const queued = await prisma.dealLaunch.count({ where: { status: "QUEUED" } });
  if (queued === 0) return Response.json({ ok: true, queued: 0, sent: 0 });
  const budget = url.searchParams.get("quick") === "1" ? 8_000 : 170_000; // wider than any pacing gap (18 MB of attachments pace 138 s apart), so every minute run sends at least one
  const sent = await pumpAllLaunches(budget).catch(() => 0);
  const left = await prisma.dealLaunch.count({ where: { status: "QUEUED" } }).catch(() => 0);
  console.log("launch pump:", sent, "sent,", left, "left");
  return Response.json({ ok: true, queued, sent, left });
}
export const GET = run;
export const POST = run;
