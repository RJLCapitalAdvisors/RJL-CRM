"use client";

import { useState } from "react";
import { Calc, Row, Select } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { IL_DIRECTIONS, IL_SUKKA, sqft, sqm, type Mirpeset } from "@/lib/israel";

export function Directions({ name, chosen }: { name: string; chosen: string[] }) {
  return (
    <div className="flex flex-wrap gap-3 py-1 text-sm">
      {IL_DIRECTIONS.map((d) => (
        <label key={d} className="flex items-center gap-1.5">
          <input type="checkbox" name={name} value={d} defaultChecked={chosen.includes(d)} className="accent-sky-600" /> {d}
        </label>
      ))}
    </div>
  );
}

/**
 * The mirpasot of an apartment or a house. "How many mirpasot" (1, 2 or 3) sits first; then, for each mirpeset,
 * its m², its square feet, its direction and whether it takes a sukka. With one mirpeset the fields keep their
 * single names (mirpesetSqm, mirpesetDirection, sukka); with more, the server sums the sizes into mirpesetSqm and
 * unions the directions into mirpesetDirection so price per meter, filters and compare keep working on totals.
 */
export function MirpasotFields({ count: c0, sqm: single, directions, mirpasot, onTotal }: { count: number | null | undefined; sqm: number | null | undefined; directions: string[]; mirpasot: Mirpeset[]; onTotal: (total: number | null) => void }) {
  const initial = c0 && c0 > 1 ? c0 : mirpasot.length > 1 ? mirpasot.length : 1;
  const [count, setCount] = useState<number>(Math.min(Math.max(initial, 1), 3));
  const [sizes, setSizes] = useState<(number | null)[]>(() => (mirpasot.length ? mirpasot.map((m) => m.sqm) : [single ?? null]));
  const many = count > 1;
  const total = (list: (number | null)[], n = count) => {
    const nums = list.slice(0, n).filter((x): x is number => x != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };
  const setSize = (k: number, v: number | null) =>
    setSizes((cur) => {
      const next = [...cur];
      while (next.length <= k) next.push(null);
      next[k] = v;
      onTotal(total(next));
      return next;
    });
  const changeCount = (v: string) => {
    const n = Math.min(Math.max(Number(v) || 1, 1), 3);
    setCount(n);
    onTotal(total(sizes, n));
  };
  const dash = "—";
  const sum = total(sizes);
  const label = (k: number, what: string) => (many ? `Mirpeset ${k + 1} ${what}` : `Mirpeset ${what}`);
  return (
    <>
      <Row label="How many mirpasot">
        <Select name="mirpesetCount" value={String(count)} options={["1", "2", "3"]} blank="1" onChange={changeCount} />
      </Row>
      {Array.from({ length: count }, (_, k) => (
        <div key={k} className="contents">
          <Row label={label(k, "m²")}>
            <NumberInput name={many ? "mirpasotSqm" : "mirpesetSqm"} defaultValue={sizes[k] ?? null} onValue={(v) => setSize(k, v)} />
          </Row>
          <Calc label={label(k, "square feet")} value={sizes[k] != null ? sqft(sizes[k]) : dash} />
          <Row label={label(k, "direction")}>
            <Directions name={many ? `mirpasotDir_${k}` : "mirpesetDirection"} chosen={mirpasot[k]?.direction ?? (k === 0 ? directions : [])} />
          </Row>
          <Row label={many ? `Mirpeset ${k + 1} sukka?` : "Sukka?"} hint={k === 0 ? "Can a sukka go on this mirpeset: yes, partial or no." : undefined}>
            <Select name={many ? "mirpasotSukka" : "sukka"} value={mirpasot[k]?.sukka ?? ""} options={IL_SUKKA} />
          </Row>
        </div>
      ))}
      {many && <Calc label="Total mirpeset" value={sum != null ? `${sqm(sum)} · ${sqft(sum)}` : dash} hint="the sum of the mirpasot, used for price per meter" />}
    </>
  );
}
