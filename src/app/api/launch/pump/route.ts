import { after } from "next/server";
import { prisma } from "@/lib/db";
import { kickPump, pumpAllLaunches } from "@/lib/launch-queue";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The launch pump, driven from the server (Oct 1, 2026). Answers at once, sends what is due from every mailbox for
 * up to four and a half minutes after the response, then calls itself again while anything is still queued, so a
 * launch finishes whether or not the Send deal page is open or the laptop is awake.
 */
async function run(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  const secret = process.env.CRON_SECRET;
  if (!secret || key !== secret) return new Response("Unauthorized", { status: 401 });
  const queued = await prisma.dealLaunch.count({ where: { status: "QUEUED" } });
  if (queued === 0) return Response.json({ ok: true, queued: 0 });
  after(async () => {
    const sent = await pumpAllLaunches(270_000).catch(() => 0);
    const left = await prisma.dealLaunch.count({ where: { status: "QUEUED" } }).catch(() => 0);
    if (left > 0) await kickPump().catch(() => false);
    console.log("launch pump:", sent, "sent,", left, "left");
  });
  return Response.json({ ok: true, queued });
}
export const GET = run;
export const POST = run;
