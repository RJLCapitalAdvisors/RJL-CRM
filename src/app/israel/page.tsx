import { PageHeader } from "@/components/ui";

export const metadata = { title: "Dashboard" };

/** RJL Israel dashboard: kept blank for now apart from Data updates, which Jonathan will define. */
export default function IsraelDashboard() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="px-8 py-5">
        <div className="card max-w-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Data updates</div>
            <span className="text-xs text-muted">0</span>
          </div>
          <div className="px-4 py-8 text-center text-sm text-muted">Nothing to review.</div>
        </div>
      </div>
    </>
  );
}
