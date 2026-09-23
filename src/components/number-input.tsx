"use client";

import { useEffect, useState } from "react";

/** Formats digits with thousands separators as you type. Submits the formatted text; the server strips the commas. */
export function NumberInput({ name, defaultValue, value, decimals = true, placeholder, className = "input", onValue, prefix }: { name: string; defaultValue?: number | string | null; value?: number | string | null; decimals?: boolean; placeholder?: string; className?: string; onValue?: (n: number | null) => void; prefix?: string }) {
  const fmt = (raw: string) => {
    let s = raw.replace(/[^0-9.]/g, "");
    if (!decimals) s = s.replace(/\./g, "");
    const [int, ...rest] = s.split(".");
    const dec = rest.length ? "." + rest.join("").slice(0, 2) : "";
    return (int ? Number(int).toLocaleString("en-US") : "") + dec;
  };
  const [v, setV] = useState(defaultValue == null || defaultValue === "" ? "" : fmt(String(defaultValue)));
  // a driven value (a figure worked out from other fields) lands in the box whenever it changes
  useEffect(() => {
    if (value === undefined) return;
    setV(value == null || value === "" ? "" : fmt(String(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const input = (
    <input
      name={name}
      value={v}
      inputMode={decimals ? "decimal" : "numeric"}
      placeholder={placeholder}
      className={`${className} tabular-nums`}
      onChange={(e) => {
        const f = fmt(e.target.value);
        setV(f);
        const n = Number(f.replace(/,/g, ""));
        onValue?.(f === "" || isNaN(n) ? null : n);
      }}
    />
  );
  if (!prefix) return input;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">{prefix}</span>
      <div className="[&>input]:pl-7">{input}</div>
    </div>
  );
}
