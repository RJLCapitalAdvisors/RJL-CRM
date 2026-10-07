import { prisma } from "@/lib/db";
import { pumpAllLaunches, scanLaunchBounces } from "@/lib/launch-queue";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The launch pump, driven from the server (Oct 1, 2026). It sends what is due from every mailbox *inside* the request:
 * for up to 55 seconds when the database's minute scheduler calls it (pg_cron on Supabase hits this URL every minute),
 * for about 8 seconds when the Send deal page kicks it after queueing (`quick=1`). Background work after the response
 * is not kept alive reliably on Vercel, which is why the first version of this route left emails sitting in the queue.
 */
async function run(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const secret = process.env.CRON_SECRET;
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });
  const queued = await prisma.dealLaunch.count({ where: { status: "QUEUED" } });
  if (queued === 0) {
    // nothing to send: just the bounce scan for mailboxes that launched lately (incremental, a second or two)
    const recent = await prisma.dealLaunch.findMany({ where: { status: "SENT", createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, distinct: ["mailbox"], select: { mailbox: true } });
    for (const b of recent) await scanLaunchBounces(b.mailbox).catch(() => 0);
    return Response.json({ ok: true, queued: 0, sent: 0 });
  }
  // each minute run lasts under a minute, so two runs never overlap; a gap longer than that is simply taken by a later minute's run
  // (the wait shrinks by sixty seconds a minute until it fits), which keeps every send within a few seconds of its due time
  const budget = url.searchParams.get("quick") === "1" ? 8_000 : 55_000;
  const sent = await pumpAllLaunches(budget).catch(() => 0);
  const left = await prisma.dealLaunch.count({ where: { status: "QUEUED" } }).catch(() => 0);
  console.log("launch pump:", sent, "sent,", left, "left");
  return Response.json({ ok: true, queued, sent, left });
}
export const GET = run;
export const POST = run;
