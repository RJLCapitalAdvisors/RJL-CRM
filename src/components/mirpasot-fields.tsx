"use client";

import { useState } from "react";
import { Calc, Row } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { IL_DIRECTIONS, sqft, sqm, type Mirpeset } from "@/lib/israel";

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
 * The mirpasot of an apartment or a house. One mirpeset keeps the single size and direction fields; more than one
 * opens a size and a direction for each, and the total is what the price per meter uses. The server sums the
 * sizes into mirpesetSqm and unions the directions into mirpesetDirection, so lists, filters and compare keep
 * working on the totals.
 */
export function MirpasotFields({ count: c0, sqm: single, directions, mirpasot, onTotal }: { count: number | null | undefined; sqm: number | null | undefined; directions: string[]; mirpasot: Mirpeset[]; onTotal: (total: number | null) => void }) {
  const [count, setCount] = useState<number | null>(c0 ?? (mirpasot.length > 1 ? mirpasot.length : single != null ? 1 : null));
  const [sizes, setSizes] = useState<(number | null)[]>(() => (mirpasot.length > 1 ? mirpasot.map((m) => m.sqm) : [single ?? null]));
  const many = (count ?? 0) > 1;
  const n = Math.min(Math.max(Math.trunc(count ?? 0), 0), 8);
  const total = (list: (number | null)[]) => {
    const nums = list.slice(0, many ? n : 1).filter((x): x is number => x != null);
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
  const changeCount = (v: number | null) => {
    setCount(v);
    onTotal(total(sizes.map((s, k) => (k < Math.max(1, Math.trunc(v ?? 0)) ? s : null))));
  };
  const dash = "—";
  const sum = total(sizes);
  return (
    <>
      <Row label="Number of mirpasot" hint="With more than one, each mirpeset gets its own size and direction.">
        <NumberInput name="mirpesetCount" defaultValue={count} decimals={false} onValue={changeCount} />
      </Row>
      {!many ? (
        <>
          <Row label="Mirpeset m²">
            <NumberInput name="mirpesetSqm" defaultValue={sizes[0] ?? null} onValue={(v) => setSize(0, v)} />
          </Row>
          <Calc label="Mirpeset square feet" value={sizes[0] != null ? sqft(sizes[0]) : dash} />
          <Row label="Mirpeset direction">
            <Directions name="mirpesetDirection" chosen={directions} />
          </Row>
        </>
      ) : (
        <>
          {Array.from({ length: n }, (_, k) => (
            <div key={k} className="contents">
              <Row label={`Mirpeset ${k + 1} m²`}>
                <NumberInput name="mirpasotSqm" defaultValue={sizes[k] ?? null} onValue={(v) => setSize(k, v)} />
              </Row>
              <Row label={`Mirpeset ${k + 1} direction`}>
                <Directions name={`mirpasotDir_${k}`} chosen={mirpasot[k]?.direction ?? (k === 0 ? directions : [])} />
              </Row>
            </div>
          ))}
          <Calc label="Total mirpeset" value={sum != null ? `${sqm(sum)} · ${sqft(sum)}` : dash} hint="the sum of the mirpasot, used for price per meter" />
        </>
      )}
    </>
  );
}
