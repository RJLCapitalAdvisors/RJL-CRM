import { AskTabs } from "./tabs";

/** Ask the CRM, RJL Acquisitions: the tabs on top, the section below. The shared chat fills the screen, so it is fitted under the tabs. */
export default function AcquisitionsAskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <AskTabs />
      <div className="min-h-0 flex-1 overflow-y-auto [&>.h-screen]:h-full">{children}</div>
    </div>
  );
}
