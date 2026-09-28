import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { engagementGroups } from "@/lib/send-deal";
import { AgreedGroups } from "./agreed-groups";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `Agreed groups ${d ? d.propertyName ?? d.name : ""}` };
}

export const dynamic = "force-dynamic";

/** Agreed groups: the step between the engagement letter and sending the deal. */
export default async function AgreedGroupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, select: { id: true, name: true, propertyName: true, stage: true, details: true, sponsorName: true } });
  if (!deal) notFound();
  const name = deal.propertyName ?? deal.name;
  const groups = (await engagementGroups(deal.id)).filter((g) => g.companyId).map((g) => ({ companyId: g.companyId, name: g.name, status: g.status }));
  const details = ((): Record<string, unknown> => {
    try {
      return JSON.parse(deal.details || "{}");
    } catch {
      return {};
    }
  })();
  const struck = (details.engagementStruck as { name: string; companyId: string | null; how: string; at: string; by: string | null }[] | undefined) ?? [];
  const confirmedAt = typeof details.engagementConfirmedAt === "string" ? details.engagementConfirmedAt : null;
  const confirmedBy = typeof details.engagementConfirmedBy === "string" ? details.engagementConfirmedBy : null;
  const signed = deal.stage !== "Engagement Letter Sent" && groups.length > 0 && !["Deal Mentioned", "Deal Received", "Deal Underwritten"].includes(deal.stage);
  return (
    <>
      <PageHeader
        title={`Agreed groups · ${name}`}
        subtitle={`${deal.stage}${deal.sponsorName ? ` · ${deal.sponsorName}` : ""} · ${groups.length} groups on the deal${struck.length ? `, ${struck.length} struck` : ""}`}
        actions={
          <>
            <Link href={`/investors?dealId=${deal.id}&mode=engagement`} className="btn-secondary">
              Engagement letter
            </Link>
            <Link href={`/deals/${deal.id}/send`} className="btn-primary">
              Send deal
            </Link>
            <Link href={`/deals/${deal.id}`} className="btn-secondary">
              Back to deal
            </Link>
          </>
        }
      />
      <AgreedGroups dealId={deal.id} groups={groups} struck={struck} confirmed={confirmedAt ? { at: confirmedAt, by: confirmedBy } : null} signed={signed} />
    </>
  );
}
