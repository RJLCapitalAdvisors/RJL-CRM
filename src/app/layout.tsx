import type { Metadata } from "next";
import { headers } from "next/headers";
import { currentUser } from "@/lib/current-user";
import "./globals.css";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { isIsraelPath } from "@/lib/workspace";

export const metadata: Metadata = {
  title: { default: "RJL CRM", template: "%s · RJL CRM" },
  description: "RJL Capital Advisors CRM",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, pathname] = await Promise.all([currentUser().catch(() => null), headers().then((h) => h.get("x-pathname") ?? "")]);
  return (
    <html lang="en">
      <body className={`flex min-h-screen ${isIsraelPath(pathname) ? "israel" : ""}`}>
        <WorkspaceSidebar user={user ? { name: user.name, workspaces: user.workspaces } : null} />
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
