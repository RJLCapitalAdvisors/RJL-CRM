import Link from "next/link";

/**
 * HubSpot-style record page: a fixed left column with the header card and the "About" fields
 * stacked in one straight line, a center column for activity, and a right column of association cards.
 */
export function RecordLayout({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[380px_1fr_340px] gap-4 px-6 py-5">
      <div className="sticky top-4 max-h-[calc(100vh-2rem)] space-y-4 overflow-y-auto pr-1">{left}</div>
      <div className="min-w-0 space-y-4">{center}</div>
      <div className="sticky top-4 max-h-[calc(100vh-2rem)] space-y-4 overflow-y-auto pr-1">{right}</div>
    </div>
  );
}

export function RecordHeader({ backHref, backLabel, initial, title, subtitle, lines, actions }: { backHref: string; backLabel: string; initial: string; title: string; subtitle?: React.ReactNode; lines?: React.ReactNode[]; actions?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <Link href={backHref} className="text-xs text-muted hover:underline">
        ← {backLabel}
      </Link>
      <div className="mt-3 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky text-base font-semibold text-ink">{initial}</div>
        <div className="min-w-0">
          <h1 className="break-words text-lg font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="text-sm text-ink-soft">{subtitle}</div>}
          {lines?.map((l, i) => (
            <div key={i} className="text-sm text-sky-600">
              {l}
            </div>
          ))}
        </div>
      </div>
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function AboutCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

/** One stacked field: label above, control below. */
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AssocCard({ title, count, addHref, addLabel = "Add", children, empty }: { title: string; count: number; addHref?: string; addLabel?: string; children?: React.ReactNode; empty: string }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">
          {title} ({count})
        </div>
        {addHref && (
          <Link href={addHref} className="text-xs font-medium text-sky-600 hover:underline">
            + {addLabel}
          </Link>
        )}
      </div>
      {count === 0 ? <div className="px-4 py-6 text-center text-xs text-muted">{empty}</div> : <div className="divide-y divide-line">{children}</div>}
    </div>
  );
}
