// Shared (public) pages render without the CRM sidebar.
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 overflow-auto bg-[#F0F2F7]">{children}</div>;
}
