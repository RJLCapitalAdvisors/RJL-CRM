"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreAqProperty } from "../../junk-actions";
import { DestroyButton } from "./destroy-button";

/**
 * Restore or remove for good from the Junk Properties sheet (Oct 5, 2026): pick a property on this page, then Restore
 * (back to the live Properties list with everything on its card) or Remove for good. The ticket itself also carries a
 * Restore button in its red Junk banner.
 */
export function JunkRowActions({ rows }: { rows: { id: string; address: string }[] }) {
  const [id, setId] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const row = rows.find((r) => r.id === id);
  if (!rows.length) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <select value={id} onChange={(e) => setId(e.target.value)} className="input w-56 py-1 text-xs" title="Pick a property on this page to restore or remove for good">
        <option value="">Restore or remove…</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.address}
          </option>
        ))}
      </select>
      {row && (
        <>
          <button
            type="button"
            disabled={pending}
            className="btn-secondary px-3 py-1 text-xs"
            title="Back to the Properties list with everything on the card"
            onClick={() =>
              start(async () => {
                await restoreAqProperty(row.id);
                setId("");
                router.refresh();
              })
            }
          >
            {pending ? "Restoring…" : "Restore"}
          </button>
          <DestroyButton id={row.id} address={row.address} />
        </>
      )}
    </div>
  );
}
