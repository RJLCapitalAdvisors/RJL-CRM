import { ClaudeUsagePage } from "@/components/claude-usage-page";

export const metadata = { title: "Claude usage" };
export const dynamic = "force-dynamic";

export default async function IlClaudeUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  return <ClaudeUsagePage workspace="IL" range={(await searchParams).range} />;
}
