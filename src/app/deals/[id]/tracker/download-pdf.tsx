"use client";

import { useState } from "react";
import { flushAutosaves } from "@/components/autosave-form";

/** Download PDF waits for anything still saving on the page, so the file carries what is on screen (Oct 13, 2026). */
export function DownloadPdfButton({ url }: { url: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-soft mr-1 px-2.5 py-1 text-xs"
      title="Download the PDF"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await flushAutosaves(); } finally { setBusy(false); }
        window.location.href = url;
      }}
    >
      {busy ? "Saving…" : "Download PDF"}
    </button>
  );
}
