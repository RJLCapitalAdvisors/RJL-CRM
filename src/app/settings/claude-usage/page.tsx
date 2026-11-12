import { ClaudeUsagePage } from "@/components/claude-usage-page";

export const metadata = { title: "Claude usage" };
export const dynamic = "force-dynamic";

export default async function CaClaudeUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  return <ClaudeUsagePage workspace="CA" range={(await searchParams).range} />;
}
