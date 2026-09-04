"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="fixed bottom-6 right-6 bg-black px-4 py-2.5 text-sm font-medium text-white shadow-lg print:hidden">
      Save as PDF
    </button>
  );
}
