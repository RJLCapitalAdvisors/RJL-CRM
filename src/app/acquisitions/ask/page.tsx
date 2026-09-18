import { Suspense } from "react";
import { currentUser } from "@/lib/current-user";
import { AskClient } from "@/app/ask/ask-client";
import { listThreads, loadThread } from "@/app/ask/actions";

export const metadata = { title: "Ask the CRM" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Ask the CRM, RJL Acquisitions: questions over properties, companies, people and the pipeline, and the place Shawn drops spreadsheets of properties to load them. Conversations are kept apart from the other sides. */
export default async function AcquisitionsAskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = typeof sp.t === "string" ? sp.t : null;
  const [me, threads, messages] = await Promise.all([currentUser(), listThreads("AQ"), t ? loadThread(t) : Promise.resolve([])]);
  return (
    <Suspense fallback={null}>
      <AskClient userName={me?.name ?? "there"} initialThreads={threads} initialThreadId={t} initialMessages={messages} basePath="/acquisitions/ask" workspace="AQ" />
    </Suspense>
  );
}
