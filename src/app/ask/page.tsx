import { Suspense } from "react";
import { currentUser } from "@/lib/current-user";
import { AskClient } from "./ask-client";
import { listThreads, loadThread } from "./actions";

export const metadata = { title: "Ask the CRM" };

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Ask the CRM: one chat box over everything the company has put into the CRM, and a place to drop a spreadsheet of companies or contacts to load them. Conversations are kept. */
export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = typeof sp.t === "string" ? sp.t : null;
  const [me, threads, messages] = await Promise.all([currentUser(), listThreads(), t ? loadThread(t) : Promise.resolve([])]);
  return (
    <Suspense fallback={null}>
      <AskClient userName={me?.name ?? "there"} initialThreads={threads} initialThreadId={t} initialMessages={messages} />
    </Suspense>
  );
}
