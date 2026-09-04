"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="fixed bottom-6 right-6 rounded-lg bg-[#111827] px-4 py-2.5 text-sm font-medium text-white shadow-lg print:hidden">
      Download PDF
    </button>
  );
}
