"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEAL_STAGES, stageTone } from "@/lib/taxonomy";
import { moveDeal } from "../actions";

/** The stage chip on the deal page, as a dropdown: pick a stage to move the deal (same as dragging on the board). */
export function StageSelect({ dealId, stage }: { dealId: string; stage: string }) {
  const [cur, setCur] = useState(stage);
  const [, start] = useTransition();
  const router = useRouter();
  return (
    <select
      value={cur}
      onChange={(e) => {
        const next = e.target.value;
        setCur(next);
        start(async () => {
          await moveDeal(dealId, next);
          router.refresh();
        });
      }}
      className={`chip cursor-pointer border pr-5 ${stageTone(cur)}`}
      title="Change stage"
    >
      {DEAL_STAGES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
