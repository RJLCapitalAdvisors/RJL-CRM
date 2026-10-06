import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Submit to RJL Israel", template: "%s · RJL Israel" }, robots: { index: false, follow: false } };

/** The public submission forms render without the CRM sidebar, in the RJL Israel look. */
export default function SubmitLayout({ children }: { children: React.ReactNode }) {
  return <div className="israel fixed inset-0 overflow-auto bg-[#f1f4fb]">{children}</div>;
}
