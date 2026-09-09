"use client";

/** The deal-form building blocks, shared: label-over-control rows in one straight column, grouped under small headings. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="mb-1 text-xs text-muted">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wide text-sky-600 first:mt-0">{title}</h3>
      <div>{children}</div>
    </section>
  );
}
export function Calc({ label, value, hint = "calculated" }: { label: string; value: string; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <div className="rounded-md bg-cream px-3 py-2 text-sm font-medium tabular-nums">{value}</div>
    </Row>
  );
}
export function Text({ name, value, placeholder }: { name: string; value?: string | number | null; placeholder?: string }) {
  return <input name={name} defaultValue={value ?? ""} placeholder={placeholder} className="input" />;
}
/** Dropdown that keeps a stored value visible even if it is not in the standard list. */
export function Select({ name, value, options, blank = "—", onChange }: { name: string; value: string; options: readonly string[]; blank?: string; onChange?: (v: string) => void }) {
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select name={name} defaultValue={onChange ? undefined : value} value={onChange ? value : undefined} onChange={onChange ? (e) => onChange(e.target.value) : undefined} className="input">
      <option value="">{blank}</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
