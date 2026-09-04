"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      title="Read-only link for the sponsor. Updates live as you change statuses."
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copy this link", url);
        }
      }}
    >
      {done ? "Link copied" : "Copy sponsor link"}
    </button>
  );
}
