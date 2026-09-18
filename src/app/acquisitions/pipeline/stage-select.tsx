"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAqDealStage } from "../actions";

/** The stage picker on a pipeline card: pick, and the card moves. */
export function StageSelect({ id, stage, stages }: { id: string; stage: string; stages: string[] }) {
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
      {stages.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
