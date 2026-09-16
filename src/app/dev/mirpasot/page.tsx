"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { MirpasotFields } from "@/components/mirpasot-fields";
import { AutoSaveForm } from "@/components/autosave-form";

/** Development only: the mirpasot fields on their own, to watch the count collapse and expand. Not served in production. */
export default function DevMirpasot() {
  if (process.env.NODE_ENV === "production") notFound();
  const [total, setTotal] = useState<number | null>(null);
  const [saves, setSaves] = useState<string[]>([]);
  return (
    <div className="mx-auto max-w-md p-6 text-sm">
      <div className="mb-3 text-xs text-muted" data-testid="total">
        total: {total ?? "none"} · saves: {saves.length}
      </div>
      <AutoSaveForm
        action={async (fd) => {
          setSaves((s) => [...s, `count=${fd.get("mirpesetCount")} names=${[...fd.keys()].filter((k) => /mirp|sukka/i.test(k)).join(",")}`]);
        }}
      >
        <MirpasotFields count={3} sqm={60} directions={["West"]} mirpasot={[{ sqm: 60, direction: ["West"], sukka: null, sukkaSqm: null, pool: null, poolSqm: null }, { sqm: 20, direction: [], sukka: null, sukkaSqm: null, pool: null, poolSqm: null }, { sqm: 10, direction: [], sukka: null, sukkaSqm: null, pool: null, poolSqm: null }]} onTotal={setTotal} />
      </AutoSaveForm>
      <pre className="mt-3 whitespace-pre-wrap text-[11px]" data-testid="saves">
        {saves.join("\n")}
      </pre>
    </div>
  );
}
