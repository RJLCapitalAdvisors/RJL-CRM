import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { signFileToken } from "@/lib/tokens";
import { FaqEditor } from "./faq-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.deal.findUnique({ where: { id }, select: { name: true, propertyName: true } });
  return { title: `Investor FAQ ${d ? d.propertyName ?? d.name : ""}` };
}

export const dynamic = "force-dynamic";

/** The Investor FAQ as something to edit, not a PDF to look at: the PDF is built from this list whenever it goes out. */
export default async function FaqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, select: { id: true, name: true, propertyName: true, facts: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, question: true, answer: true, source: true, inFaq: true } } } });
  if (!deal) notFound();
  const name = deal.propertyName ?? deal.name;
  return (
    <>
      <PageHeader
        title={`Investor FAQ · ${name}`}
        subtitle={`${deal.facts.filter((f) => f.inFaq).length} questions on the FAQ · ${deal.facts.length} answered on the ticket in all`}
        actions={
          <>
            <a href={`/api/deals/${deal.id}/faq.pdf?t=${signFileToken(`faq:${deal.id}`)}`} target="_blank" rel="noreferrer" className="btn-secondary">
              See the PDF
            </a>
            <Link href={`/deals/${deal.id}`} className="btn-secondary">
              Back to deal
            </Link>
          </>
        }
      />
      <FaqEditor dealId={deal.id} items={deal.facts} />
    </>
  );
}
