"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

/** Copy the form's link, or open it in a new tab. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt("Copy the link:", url);
          }
        }}
      >
        <Copy className="h-3.5 w-3.5" />
        {copied ? "Copied" : "Copy link"}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <ExternalLink className="h-3.5 w-3.5" />
        Open
      </a>
    </div>
  );
}
