"use client";

import { useState } from "react";

/**
 * A <select> that survives a form action. React resets a form after its action runs; an uncontrolled select
 * goes back to the option that was selected when the page first rendered (the dash), even though the save
 * went through. Keeping the value in state makes React restore the pick instead.
 */
export function SelectField({ name, id, defaultValue = "", className = "input", children, onValue }: { name: string; id?: string; defaultValue?: string | null; className?: string; children: React.ReactNode; onValue?: (v: string) => void }) {
  const [v, setV] = useState(defaultValue ?? "");
  return (
    <select
      id={id}
      name={name}
      value={v}
      className={className}
      onChange={(e) => {
        setV(e.target.value);
        onValue?.(e.target.value);
      }}
    >
      {children}
    </select>
  );
}
