import { notFound } from "next/navigation";
import { verifyContactToken } from "@/lib/tokens";
import { loadReport } from "@/lib/tracker-report";
import { ReportView } from "@/components/report-view";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** Read-only, no-login progress report for sponsors. The link carries a signed token for the deal. */
export default async function SharedTracker({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dealId = verifyContactToken(token);
  if (!dealId) notFound();
  const report = await loadReport(dealId);
  if (!report) notFound();
  return (
    <div className="min-h-screen bg-[#f3f4f6] px-5 py-8 print:bg-white print:p-0">
      <ReportView report={report} />
      <PrintButton />
    </div>
  );
}
