import { ClaudeUsagePage } from "@/components/claude-usage-page";

export const metadata = { title: "Claude usage" };
export const dynamic = "force-dynamic";

export default async function AqClaudeUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  return <ClaudeUsagePage workspace="AQ" range={(await searchParams).range} />;
}
