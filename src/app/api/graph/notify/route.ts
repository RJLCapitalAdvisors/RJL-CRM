import { after } from "next/server";
import { processDealsInbox } from "@/lib/deals-inbox";
import { processIsraelInbox } from "@/lib/israel-intake";

export const maxDuration = 300;

/** Microsoft Graph change notifications for the deals@ inbox. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });

  const body = (await req.json().catch(() => ({}))) as { value?: { clientState?: string }[] };
  const ok = (body.value ?? []).some((n) => n.clientState === process.env.CRON_SECRET);
  if (!ok) return new Response("Bad clientState", { status: 202 }); // 202 so Graph does not retry forever
  after(async () => {
    try {
      await processDealsInbox();
      await processIsraelInbox().catch((e) => console.error("israel inbox", e));
    } catch (e) {
      console.error("deals inbox processing failed", e);
    }
  });
  return new Response(null, { status: 202 });
}

export async function GET(req: Request) {
  const validationToken = new URL(req.url).searchParams.get("validationToken");
  return new Response(validationToken ?? "ok", { status: 200, headers: { "Content-Type": "text/plain" } });
}
