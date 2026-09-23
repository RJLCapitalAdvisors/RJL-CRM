"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAqContactStage, setAqDealStage } from "../actions";
import type { AqPipeline } from "@/lib/acquisitions";

/** The stage picker on a pipeline card: pick, and the card moves. */
export function StageSelect({ pipeline = "deals", id, stage, stages }: { pipeline?: AqPipeline; id: string; stage: string; stages: string[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      value={stage}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          if (pipeline === "deals") await setAqDealStage(id, e.target.value);
          else await setAqContactStage(pipeline, id, e.target.value);
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
