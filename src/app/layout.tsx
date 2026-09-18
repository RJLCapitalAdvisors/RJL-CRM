import type { Metadata } from "next";
import { headers } from "next/headers";
import { currentUser } from "@/lib/current-user";
import "./globals.css";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { isAcquisitionsPath, isIsraelPath } from "@/lib/workspace";
import { kickAcquisitionsMailSync } from "@/lib/acquisitions-mail";
import { kickMailSync } from "@/lib/mail-sync";
import { kickIsraelMailSync } from "@/lib/israel-mail";

export const metadata: Metadata = {
  title: { default: "RJL CRM", template: "%s · RJL CRM" },
  description: "RJL Capital Advisors CRM",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, pathname] = await Promise.all([currentUser().catch(() => null), headers().then((h) => h.get("x-pathname") ?? "")]);
  // any page someone opens refreshes that side's email log in the background (throttled), so an email a teammate just
  // sent shows on the contact and company pages without waiting for the daily cron or a dashboard visit
  if (user && !pathname.startsWith("/api")) {
    if (isIsraelPath(pathname)) kickIsraelMailSync();
    else if (isAcquisitionsPath(pathname)) kickAcquisitionsMailSync();
    else kickMailSync();
  }
  return (
    <html lang="en">
      <body className={`flex min-h-screen ${isIsraelPath(pathname) ? "israel" : isAcquisitionsPath(pathname) ? "acquisitions" : ""}`}>
        <WorkspaceSidebar user={user ? { name: user.name, workspaces: user.workspaces, accounts: user.accounts } : null} />
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
