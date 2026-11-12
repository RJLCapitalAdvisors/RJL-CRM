import { usageMeter } from "@/lib/claude-usage";

export const dynamic = "force-dynamic";

/** The sidebar meter and the out-of-credits banner read this: today's and this month's Claude cost, and whether the account is out of credits. Signed-in people only (the proxy). */
export async function GET() {
  return Response.json(await usageMeter(), { headers: { "Cache-Control": "no-store" } });
}
