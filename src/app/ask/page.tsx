import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { AskClient } from "./ask-client";
import { listThreads, loadThread } from "./actions";

export const metadata = { title: "Ask the CRM" };

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Ask the CRM: one chat box over everything the company has put into the CRM. Read-only; conversations are kept. */
export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = typeof sp.t === "string" ? sp.t : null;
  const [me, threads, messages] = await Promise.all([currentUser(), listThreads(), t ? loadThread(t) : Promise.resolve([])]);
  return (
    <>
      <PageHeader compact title="Ask the CRM" subtitle="Questions answered from the CRM's own records, with links back to them. Conversations stay in the left column." />
      <Suspense fallback={null}>
        <AskClient userName={me?.name ?? "there"} initialThreads={threads} initialThreadId={t} initialMessages={messages} />
      </Suspense>
    </>
  );
}
