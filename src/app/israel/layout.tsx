import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "RJL Israel", template: "%s · RJL Israel" },
  description: "RJL Israel CRM",
};

/** RJL Israel pages share the one sidebar; the dark look comes from the `israel` class the root layout puts on the body. */
export default function IsraelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
