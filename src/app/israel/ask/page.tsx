import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { AskClient } from "@/app/ask/ask-client";
import { listThreads, loadThread } from "@/app/ask/actions";

export const metadata = { title: "Ask the CRM" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Ask the CRM, RJL Israel: questions over apartments, projects, buyers, agents and the deals funnel. Conversations are kept apart from RJL CA's. */
export default async function IsraelAskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = typeof sp.t === "string" ? sp.t : null;
  const [me, threads, messages] = await Promise.all([currentUser(), listThreads("IL"), t ? loadThread(t) : Promise.resolve([])]);
  return (
    <>
      <PageHeader compact title="Ask the CRM" subtitle="Questions answered from RJL Israel's own records, with links back to them. Conversations stay in the left column." />
      <Suspense fallback={null}>
        <AskClient userName={me?.name ?? "there"} initialThreads={threads} initialThreadId={t} initialMessages={messages} basePath="/israel/ask" workspace="IL" />
      </Suspense>
    </>
  );
}
