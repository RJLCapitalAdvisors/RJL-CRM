"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { moveAqDeal } from "./actions";

/**
 * Move a property between the two deal lists (Jonathan, Oct 5, 2026): a potential deal on the Deals Pipeline list
 * becomes an active deal on the Deals board ("Make it a deal"), an active deal goes back to potential ("Back to
 * potential"). Same record, so its notes, transcripts and history come with it.
 */
export function DealMove({ id, to }: { id: string; to: "board" | "pipeline" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await moveAqDeal(id, to);
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:border-sky-600 hover:text-sky-700"
      title={to === "board" ? "Tick Deal: an active deal on the Deals board, off the Deals Pipeline list" : "Clear Deal: back to a potential deal on the Deals Pipeline list"}
    >
      <ArrowLeftRight className="h-3.5 w-3.5" />
      {pending ? "Moving…" : to === "board" ? "Make it a deal" : "Back to potential"}
    </button>
  );
}
