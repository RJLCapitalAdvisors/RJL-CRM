import { PageHeader } from "@/components/ui";
import { currentUser } from "@/lib/current-user";
import { AskClient } from "./ask-client";

export const metadata = { title: "Ask the CRM" };

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Ask the CRM: one chat box over everything the company has put into the CRM. Read-only. */
export default async function AskPage() {
  const me = await currentUser();
  return (
    <>
      <PageHeader compact title="Ask the CRM" subtitle="Questions answered from the CRM's own records, with links back to them. It reads; it does not change anything." />
      <AskClient userName={me?.name ?? "there"} />
    </>
  );
}
