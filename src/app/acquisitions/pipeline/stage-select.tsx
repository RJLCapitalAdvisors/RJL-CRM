"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AQ_DEAL_STAGES } from "@/lib/acquisitions";
import { setAqDealStage } from "../actions";

/** The stage picker on a pipeline card: pick, and the card moves. */
export function StageSelect({ id, stage }: { id: string; stage: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      value={stage}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setAqDealStage(id, e.target.value);
          router.refresh();
        })
      }
      className="input py-0.5 text-[11px]"
      title="Move to another stage"
    >
      {AQ_DEAL_STAGES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
