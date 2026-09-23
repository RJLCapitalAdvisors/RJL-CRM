"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { destroyAqProperty } from "../../junk-actions";

/** Remove for good: a second confirm, since this one cannot be undone. */
export function DestroyButton({ id, address }: { id: string; address: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open)
    return (
      <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setOpen(true)} title="Delete the card, its notes, transcripts and links. Cannot be undone.">
        Remove for good
      </button>
    );
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-red-700">Delete “{address}” for good?</span>
      <button type="button" disabled={pending} className="btn-primary bg-red-700 px-2 py-0.5 text-xs hover:bg-red-800" onClick={() => start(async () => { await destroyAqProperty(id); router.refresh(); })}>
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="text-muted hover:underline" onClick={() => setOpen(false)}>
        Keep
      </button>
    </span>
  );
}
